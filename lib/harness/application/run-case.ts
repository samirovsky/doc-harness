import type { CaseInput, CaseOutput, AnswerValue, Question } from "../domain/contract";
import { CostLedger, type PriceCaps } from "../domain/cost";
import type { Corpus } from "../domain/document";
import { validateCaseOutput } from "../domain/output";
import { documentCatalog, runAgent } from "./agent";
import { createAgentToolbox } from "./agent-tools";
import { resolveConfig, type HarnessConfig } from "./config";
import { dossierForBatch, planDossier, type DossierPlan } from "./dossier";
import { extractJsonObject } from "./json";
import { batchQuestions } from "./batching";
import { HedgingGateway } from "./hedging-gateway";
import { createLimiter, MeteredGateway } from "./metered-gateway";
import { silentLogger, type LlmGateway, type Logger } from "./ports";
import { answerSystemPrompt, answerUserPrompt, type CaseContext } from "./prompts";
import { isPublishable, needsEscalation, reconcile, type Candidate, type Flag, type RawAnswer } from "./reconcile";
import { triageDocuments, type DocumentRole, type TriageResult } from "./triage";
import { transcribeWeakImages } from "./vision";

export interface RunCaseDependencies {
  gateway: LlmGateway;
  corpus: Corpus;
  priceCaps: PriceCaps;
  config?: Partial<HarnessConfig>;
  logger?: Logger;
  now?: () => number;
}

export interface BatchTrace {
  questionIds: string[];
  mode: "full" | "retrieval";
  dossierTokens: number;
  ok: boolean;
  attempts: number;
  ms: number;
  error?: string;
}

export interface AnswerTrace {
  source: "first_pass" | "agent" | "fallback_first_pass" | "unanswered";
  flags: Flag[];
  rationale: string;
  calc: string | null;
  confidence: number | null;
}

export interface RunTrace {
  config: HarnessConfig;
  triage: { ok: boolean; roles: Record<string, DocumentRole>; context: CaseContext; error?: string };
  visionTranscribed: string[];
  batches: BatchTrace[];
  flags: Record<string, Flag[]>;
  escalated: string[];
  agentCalls: Record<string, number>;
  answers: Record<string, AnswerTrace>;
  cost: { totalUsd: number; calls: number; estimatedCalls: number; hedges: number; byPurpose: Record<string, number>; tokens: CostLedger["tokens"] };
  calls: { purpose: string; ms: number | null; promptTokens: number; completionTokens: number; cachedTokens: number; costUsd: number }[];
  durationMs: number;
}

const ESCALATION_PRIORITY: Flag[] = ["missing", "invalid_value", "calc_mismatch", "no_evidence", "low_confidence"];

function parseBatchAnswers(content: string, batch: Question[]): Map<string, RawAnswer> {
  const parsed = extractJsonObject(content) as { answers?: unknown } & Record<string, unknown>;
  let entries: RawAnswer[] = [];
  if (Array.isArray(parsed.answers)) entries = parsed.answers as RawAnswer[];
  else if (parsed.answers && typeof parsed.answers === "object") {
    entries = Object.entries(parsed.answers as Record<string, Omit<RawAnswer, "questionId">>).map(([questionId, answer]) => ({ ...answer, questionId }));
  }
  const ids = new Set(batch.map((question) => question.questionId));
  const result = new Map<string, RawAnswer>();
  entries.forEach((entry, position) => {
    if (!entry || typeof entry !== "object") return;
    const id = ids.has(String(entry.questionId)) ? String(entry.questionId) : entries.length === batch.length ? batch[position].questionId : null;
    if (id && !result.has(id)) result.set(id, { ...entry, questionId: id });
  });
  if (result.size === 0) throw new Error("no answers in model response");
  return result;
}

/**
 * Orchestrates one run: (vision fallback) → authority triage → dossier plan →
 * parallel batched answering → deterministic reconciliation → bounded agent
 * escalation → schema-valid output with total cost.
 */
export async function runCase(input: CaseInput, dependencies: RunCaseDependencies): Promise<{ output: CaseOutput; trace: RunTrace }> {
  const config = resolveConfig(dependencies.config);
  const logger = dependencies.logger ?? silentLogger;
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const ledger = new CostLedger(dependencies.priceCaps);
  const hedging = new HedgingGateway(dependencies.gateway, ledger, {
    afterMs: config.hedgeAfterMs,
    purposes: ["triage", "answer", "agent", "vision"],
  });
  const gateway = new MeteredGateway(hedging, ledger);
  const limit = createLimiter(config.concurrency);
  const controller = new AbortController();
  const hardStop = setTimeout(() => controller.abort(new Error("run deadline exceeded")), config.deadlineMs + 30_000);
  const signal = controller.signal;

  try {
    // 1. Vision fallback for images whose OCR was too weak to trust.
    let corpus = dependencies.corpus;
    let visionTranscribed: string[] = [];
    if (config.vision) {
      ({ corpus, transcribed: visionTranscribed } = await transcribeWeakImages(corpus, gateway, { logger, signal, limit }));
    }

    // 2. Authority triage (fail-open).
    const triage: TriageResult = config.triage
      ? await triageDocuments(corpus, gateway, { reasoning: "off", temperature: config.temperature, logger, signal })
      : { ok: true, roles: new Map(corpus.documents.map((document) => [document.fileId, "core" as DocumentRole])), reasons: new Map(), context: { subject: null, asOfDate: null } };
    const plan: DossierPlan = planDossier(corpus, triage, config.dossierTokenBudget, config.retrievalChunkTokens);
    logger.info(`dossier: ${plan.mode}, ${plan.included.length}/${corpus.documents.length} documents${plan.fullTokens ? `, ~${plan.fullTokens} tokens` : ""}`);

    // 3. Batched first pass, all batches in parallel.
    const questions = input.questions;
    const raw = new Map<string, RawAnswer>();
    const batches: BatchTrace[] = [];
    await Promise.all(
      batchQuestions(questions, config.batchSize).map((batch) =>
        limit(async () => {
          const batchStartedAt = now();
          const dossier = dossierForBatch(plan, batch);
          const trace: BatchTrace = { questionIds: batch.map((q) => q.questionId), mode: dossier.mode, dossierTokens: dossier.tokens, ok: false, attempts: 0, ms: 0 };
          batches.push(trace);
          for (let attempt = 1; attempt <= 2 && !trace.ok; attempt += 1) {
            trace.attempts = attempt;
            try {
              const response = await gateway.complete(
                {
                  purpose: "answer",
                  json: true,
                  reasoning: config.answerReasoning,
                  maxTokens: config.answerMaxTokens,
                  temperature: config.temperature,
                  messages: [
                    { role: "system", content: answerSystemPrompt(triage.context, dossier.text) },
                    { role: "user", content: answerUserPrompt(batch) },
                  ],
                  meta: { questions: batch.map(({ questionId, answerType }) => ({ questionId, answerType })), dossierFileIds: dossier.fileIds },
                },
                signal,
              );
              for (const [questionId, answer] of parseBatchAnswers(response.content, batch)) raw.set(questionId, answer);
              trace.ok = true;
              trace.error = undefined;
            } catch (error) {
              trace.error = (error as Error).message;
              logger.warn(`answer batch ${trace.questionIds[0]}… attempt ${attempt} failed: ${trace.error}`);
              if (signal.aborted) break;
            }
          }
          trace.ms = now() - batchStartedAt;
        }),
      ),
    );

    // 4. Deterministic reconciliation.
    const fileIds = corpus.documents.map((document) => document.fileId);
    const groundingDocuments = corpus.documents.filter((document) => triage.roles.get(document.fileId) !== "archive");
    const reconcileContext = { fileIds, groundingDocuments, escalationConfidence: config.escalationConfidence };
    const firstPass = new Map<string, Candidate>(questions.map((question) => [question.questionId, reconcile(question, raw.get(question.questionId), reconcileContext)]));

    // 5. Bounded escalation of flagged answers to the tool-using agent.
    const final = new Map<string, { candidate: Candidate | null; source: AnswerTrace["source"] }>();
    const escalated: string[] = [];
    const agentCalls: Record<string, number> = {};
    const flagged = questions
      .filter((question) => needsEscalation(firstPass.get(question.questionId)!))
      .sort((left, right) => {
        const rank = (question: Question) => Math.min(...firstPass.get(question.questionId)!.flags.map((flag) => {
          const index = ESCALATION_PRIORITY.indexOf(flag);
          return index === -1 ? 99 : index;
        }));
        return rank(left) - rank(right);
      });
    const toEscalate = config.escalation && now() < startedAt + config.deadlineMs ? flagged.slice(0, config.maxEscalations) : [];
    if (toEscalate.length > 0) {
      const toolbox = createAgentToolbox(corpus, triage.roles);
      const catalog = documentCatalog(corpus, triage.roles);
      await Promise.all(
        toEscalate.map((question) =>
          limit(async () => {
            if (now() > startedAt + config.deadlineMs) return;
            escalated.push(question.questionId);
            const outcome = await runAgent(
              question,
              firstPass.get(question.questionId),
              { gateway, toolbox, context: triage.context, catalog },
              { maxSteps: config.agentMaxSteps, reasoning: config.agentReasoning, maxTokens: config.agentMaxTokens, temperature: config.temperature, signal },
            );
            agentCalls[question.questionId] = outcome.calls;
            if (outcome.error) logger.warn(`agent ${question.questionId}: ${outcome.error}`);
            if (outcome.answer) {
              const candidate = reconcile(question, outcome.answer, { ...reconcileContext, escalationConfidence: 0 });
              if (isPublishable(candidate)) final.set(question.questionId, { candidate, source: "agent" });
            }
          }),
        ),
      );
    }

    // 6. Assemble with fallbacks: agent → first pass (calc-corrected) → null.
    const answers: Record<string, AnswerValue> = {};
    const answerTraces: Record<string, AnswerTrace> = {};
    for (const question of questions) {
      const first = firstPass.get(question.questionId)!;
      const chosen =
        final.get(question.questionId) ??
        (isPublishable(first)
          ? { candidate: first, source: escalated.includes(question.questionId) ? ("fallback_first_pass" as const) : ("first_pass" as const) }
          : { candidate: null, source: "unanswered" as const });
      const candidate = chosen.candidate;
      answers[question.questionId] =
        candidate && candidate.value !== null
          ? { value: candidate.value, evidenceFileIds: candidate.evidenceFileIds }
          : { value: null, evidenceFileIds: [] };
      answerTraces[question.questionId] = {
        source: chosen.source,
        flags: first.flags,
        rationale: candidate?.rationale ?? first.rationale,
        calc: candidate?.calc ?? null,
        confidence: candidate?.confidence ?? null,
      };
    }

    const output: CaseOutput = { caseId: input.caseId, estimatedCostUsd: ledger.totalUsd, answers };
    const problems = validateCaseOutput(output);
    if (problems.length > 0) logger.warn(`output validation: ${problems.join("; ")}`);

    const byPurpose: Record<string, number> = {};
    for (const entry of ledger.entries) byPurpose[entry.purpose] = Math.round(((byPurpose[entry.purpose] ?? 0) + entry.costUsd) * 1e8) / 1e8;
    const trace: RunTrace = {
      config,
      triage: { ok: triage.ok, roles: Object.fromEntries(triage.roles), context: triage.context, error: triage.error },
      visionTranscribed,
      batches,
      flags: Object.fromEntries([...firstPass].map(([questionId, candidate]) => [questionId, candidate.flags])),
      escalated,
      agentCalls,
      answers: answerTraces,
      cost: {
        totalUsd: ledger.totalUsd,
        calls: ledger.entries.length,
        estimatedCalls: ledger.entries.filter((entry) => entry.estimated).length,
        hedges: hedging.hedges,
        byPurpose,
        tokens: ledger.tokens,
      },
      calls: ledger.entries.map((entry) => ({
        purpose: entry.purpose,
        ms: entry.ms ?? null,
        promptTokens: entry.usage.promptTokens,
        completionTokens: entry.usage.completionTokens,
        cachedTokens: entry.usage.cachedTokens ?? 0,
        costUsd: entry.costUsd,
      })),
      durationMs: now() - startedAt,
    };
    return { output, trace };
  } finally {
    clearTimeout(hardStop);
  }
}
