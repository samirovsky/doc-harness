import type { CaseInput, CaseOutput, AnswerValue, Question } from "../domain/contract";
import { CostLedger, type PriceCaps } from "../domain/cost";
import type { Corpus } from "../domain/document";
import { validateCaseOutput } from "../domain/output";
import { documentCatalog, runAgent } from "./agent";
import { createAgentToolbox } from "./agent-tools";
import { resolveConfig, type HarnessConfig } from "./config";
import { dossierForBatch, planDossier, type DossierPlan } from "./dossier";
import { parseBatchAnswers } from "./batch-answers";
import { adjudicate } from "./adjudicate";
import { expressionReferences, hasReferences } from "../domain/arithmetic";
import { batchQuestions } from "./batching";
import { HedgingGateway } from "./hedging-gateway";
import { createLimiter, MeteredGateway } from "./metered-gateway";
import { silentLogger, type LlmGateway, type LlmUsage, type Logger } from "./ports";
import { answerSystemPrompt, answerUserPrompt, type CaseContext } from "./prompts";
import { applyDerivations, isPublishable, needsEscalation, reconcile, type Candidate, type Flag, type RawAnswer } from "./reconcile";
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
  /** 1 = authoritative pass, 2 = self-consistency pass. */
  pass: 1 | 2;
  questionIds: string[];
  mode: "full" | "retrieval";
  dossierTokens: number;
  ok: boolean;
  attempts: number;
  ms: number;
  error?: string;
  finishReason?: string;
  provider?: string;
  completionTokens?: number;
  usage?: LlmUsage;
  /** Raw model output (truncated) for post-run inspection. */
  rawContent?: string;
}

export interface AnswerTrace {
  source: "first_pass" | "derivation" | "adjudication" | "agent" | "fallback_first_pass" | "unanswered";
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
  consistency: { enabled: boolean; completedBatches: number; abandonedBatches: number; disagreements: string[]; resolvedByDerivation: string[] };
  flags: Record<string, Flag[]>;
  adjudicated: string[];
  escalated: string[];
  agentCalls: Record<string, number>;
  answers: Record<string, AnswerTrace>;
  cost: { totalUsd: number; calls: number; estimatedCalls: number; hedges: number; byPurpose: Record<string, number>; tokens: CostLedger["tokens"] };
  calls: { purpose: string; ms: number | null; promptTokens: number; completionTokens: number; cachedTokens: number; costUsd: number; estimated: boolean }[];
  durationMs: number;
}

const ESCALATION_PRIORITY: Flag[] = ["missing", "invalid_value", "disagreement", "calc_mismatch", "no_evidence", "low_confidence"];

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
    maxHedges: config.maxHedges,
    purposes: ["triage", "answer", "verify", "agent", "vision"],
    adapt: config.hedgeReasoning ? (request) => ({ ...request, reasoning: config.hedgeReasoning! }) : undefined,
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
    let triage: TriageResult = config.triage
      ? await triageDocuments(corpus, gateway, { reasoning: "off", temperature: config.temperature, logger, signal })
      : { ok: true, roles: new Map(corpus.documents.map((document) => [document.fileId, "core" as DocumentRole])), reasons: new Map(), context: { subject: null, asOfDate: null } };
    let plan: DossierPlan = planDossier(corpus, triage, config.dossierTokenBudget, config.retrievalChunkTokens);
    // Plausibility check: a triage that archives nothing while the corpus overflows the prompt
    // budget is retried once (cheap, compact output); the retry wins if it succeeds.
    if (config.triage && triage.ok && plan.mode === "retrieval" && ![...triage.roles.values()].includes("archive")) {
      logger.warn("triage archived nothing for an over-budget corpus; retrying once");
      const retry = await triageDocuments(corpus, gateway, { reasoning: "off", temperature: config.temperature, logger, signal });
      if (retry.ok) {
        triage = retry;
        plan = planDossier(corpus, triage, config.dossierTokenBudget, config.retrievalChunkTokens);
      }
    }
    logger.info(`dossier: ${plan.mode}, ${plan.included.length}/${corpus.documents.length} documents${plan.fullTokens ? `, ~${plan.fullTokens} tokens` : ""}`);

    // 3. Batched answering, all batches in parallel: pass 1 (authoritative) and,
    //    for self-consistency, an independent pass 2 bounded by a grace period.
    const questions = input.questions;
    const groups = batchQuestions(questions, config.batchSize);
    const batches: BatchTrace[] = [];
    const runBatch = async (batch: Question[], pass: 1 | 2, passSignal: AbortSignal, sink: Map<string, RawAnswer>) => {
      if (passSignal.aborted) return;
      const batchStartedAt = now();
      const dossier = dossierForBatch(plan, batch);
      const trace: BatchTrace = { pass, questionIds: batch.map((q) => q.questionId), mode: dossier.mode, dossierTokens: dossier.tokens, ok: false, attempts: 0, ms: 0 };
      batches.push(trace);
      // Pass 2 samples differently (temperature, reversed question order) so its errors are less
      // correlated with pass 1; it gets a single attempt and is never hedged.
      const ordered = pass === 1 ? batch : [...batch].reverse();
      for (let attempt = 1; attempt <= (pass === 1 ? 2 : 1) && !trace.ok; attempt += 1) {
        trace.attempts = attempt;
        try {
          const response = await gateway.complete(
            {
              purpose: pass === 1 ? "answer" : "consistency",
              json: true,
              reasoning: config.answerReasoning,
              maxTokens: config.answerMaxTokens,
              temperature: pass === 1 ? config.temperature : config.consistencyTemperature,
              messages: [
                { role: "system", content: answerSystemPrompt(triage.context, dossier.text) },
                { role: "user", content: answerUserPrompt(ordered) },
              ],
              meta: { pass, questions: ordered.map(({ questionId, answerType }) => ({ questionId, answerType })), dossierFileIds: dossier.fileIds },
            },
            passSignal,
          );
          trace.finishReason = response.finishReason;
          trace.provider = response.provider;
          trace.completionTokens = response.usage.completionTokens;
          trace.usage = response.usage;
          trace.rawContent = response.content.slice(0, 6_000);
          for (const [questionId, answer] of parseBatchAnswers(response.content, batch)) sink.set(questionId, answer);
          trace.ok = true;
          trace.error = undefined;
        } catch (error) {
          trace.error = (error as Error).message;
          if (!passSignal.aborted) logger.warn(`pass ${pass} batch ${trace.questionIds[0]}… attempt ${attempt} failed: ${trace.error}`);
          if (passSignal.aborted) break;
        }
      }
      trace.ms = now() - batchStartedAt;
    };

    const raw = new Map<string, RawAnswer>();
    const secondRaw = new Map<string, RawAnswer>();
    const secondPass = new AbortController();
    const secondSignal = AbortSignal.any([signal, secondPass.signal]);
    const firstPassDone = Promise.all(groups.map((batch) => limit(() => runBatch(batch, 1, signal, raw))));
    const secondPassDone = config.consistency
      ? Promise.allSettled(groups.map((batch) => limit(() => runBatch(batch, 2, secondSignal, secondRaw))))
      : Promise.resolve([]);
    await firstPassDone;
    const consistency = { enabled: config.consistency, completedBatches: 0, abandonedBatches: 0, disagreements: [] as string[], resolvedByDerivation: [] as string[] };
    if (config.consistency) {
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([secondPassDone, new Promise((resolve) => (graceTimer = setTimeout(resolve, config.consistencyGraceMs)))]);
      clearTimeout(graceTimer);
      // Snapshot what finished in time, then abandon the rest; book an estimate for each
      // abandoned call (priced like its pass-1 twin) because it may have been billed.
      const finished = new Map(secondRaw);
      const late = batches.filter((batch) => batch.pass === 2 && !batch.ok && !batch.error);
      secondPass.abort(new Error("second pass grace period elapsed"));
      for (const batch of late) {
        const twin = batches.find((candidate) => candidate.pass === 1 && candidate.questionIds[0] === batch.questionIds[0]);
        if (twin?.usage) ledger.record("consistency:abandoned", { ...twin.usage, cachedTokens: 0 }, undefined, true);
      }
      secondRaw.clear();
      for (const [questionId, answer] of finished) secondRaw.set(questionId, answer);
      consistency.completedBatches = batches.filter((batch) => batch.pass === 2 && batch.ok).length;
      consistency.abandonedBatches = late.length;
    }

    // 4. Deterministic reconciliation.
    const fileIds = corpus.documents.map((document) => document.fileId);
    const groundingDocuments = corpus.documents.filter((document) => triage.roles.get(document.fileId) !== "archive");
    const reconcileContext = { fileIds, groundingDocuments, escalationConfidence: config.escalationConfidence };
    const firstPass = new Map<string, Candidate>(questions.map((question) => [question.questionId, reconcile(question, raw.get(question.questionId), reconcileContext)]));
    const alternatives = new Map<string, Candidate>();
    for (const question of questions) {
      const second = secondRaw.get(question.questionId);
      const first = firstPass.get(question.questionId)!;
      if (!second || first.flags.includes("missing")) continue;
      const candidate = reconcile(question, second, reconcileContext);
      if (candidate.flags.includes("invalid_value") || Object.is(candidate.value, first.value)) continue;
      first.flags.push("disagreement");
      alternatives.set(question.questionId, candidate);
      consistency.disagreements.push(question.questionId);
    }

    // 5. Bounded escalation of flagged answers to the tool-using agent.
    const final = new Map<string, { candidate: Candidate | null; source: AnswerTrace["source"] }>();
    const escalated: string[] = [];
    const agentCalls: Record<string, number> = {};
    const adjudicated: string[] = [];
    // A candidate derived from other questions (calc in terms of their ids) is recomputed from
    // their final answers at assembly, so it is consistent by construction. When only one of the
    // two candidates is derived, it wins outright; its components are settled on their own
    // (agreement, derivation or adjudication) before the recomputation.
    const questionIds = questions.map((question) => question.questionId);
    const isDerived = (candidate: Candidate | undefined, self: string) => {
      if (!candidate?.calc || !hasReferences(candidate.calc)) return false;
      const references = expressionReferences(candidate.calc, questionIds);
      return references.length > 0 && !references.includes(self);
    };
    for (const question of questions.filter((candidate) => alternatives.has(candidate.questionId))) {
      const first = firstPass.get(question.questionId)!;
      const second = alternatives.get(question.questionId)!;
      const [firstDerived, secondDerived] = [isDerived(first, question.questionId), isDerived(second, question.questionId)];
      if (firstDerived === secondDerived) continue;
      final.set(question.questionId, { candidate: firstDerived ? first : second, source: "derivation" });
      consistency.resolvedByDerivation.push(question.questionId);
    }
    const disagreeing = questions.filter((question) => alternatives.has(question.questionId) && !final.has(question.questionId));
    const flagged = questions
      .filter((question) => !alternatives.has(question.questionId) && needsEscalation(firstPass.get(question.questionId)!))
      .sort((left, right) => {
        const rank = (question: Question) => Math.min(...firstPass.get(question.questionId)!.flags.map((flag) => {
          const index = ESCALATION_PRIORITY.indexOf(flag);
          return index === -1 ? 99 : index;
        }));
        return rank(left) - rank(right);
      });
    // 5a. Self-consistency: settle each disagreement with one adjudication call (in parallel).
    const adjudication = disagreeing.length
      ? (async () => {
          const stop = new AbortController();
          const budget = setTimeout(() => stop.abort(new Error("adjudication budget exhausted")), config.adjudicationBudgetMs);
          await Promise.all(
            disagreeing.map((question) =>
              limit(async () => {
                adjudicated.push(question.questionId);
                try {
                  const verdict = await adjudicate(
                    question,
                    firstPass.get(question.questionId)!,
                    alternatives.get(question.questionId)!,
                    { gateway, context: triage.context, dossier: dossierForBatch(plan, [question]) },
                    { reasoning: config.answerReasoning, maxTokens: config.answerMaxTokens, temperature: config.temperature, signal: AbortSignal.any([signal, stop.signal]) },
                  );
                  const candidate = verdict && reconcile(question, verdict, { ...reconcileContext, escalationConfidence: 0 });
                  if (candidate && isPublishable(candidate)) final.set(question.questionId, { candidate, source: "adjudication" });
                } catch (error) {
                  logger.warn(`adjudication ${question.questionId}: ${(error as Error).message}`);
                }
              }),
            ),
          );
          clearTimeout(budget);
        })()
      : Promise.resolve();

    // 5b. Tool-using agent for the other flags (runs concurrently with adjudication).
    const toEscalate = config.escalation && now() < startedAt + config.deadlineMs ? flagged.slice(0, config.maxEscalations) : [];
    if (toEscalate.length > 0) {
      const toolbox = createAgentToolbox(corpus, triage.roles);
      const catalog = documentCatalog(corpus, triage.roles);
      const escalation = new AbortController();
      const escalationSignal = AbortSignal.any([signal, escalation.signal]);
      const budget = setTimeout(() => escalation.abort(new Error("escalation budget exhausted")), config.escalationBudgetMs);
      await Promise.all(
        toEscalate.map((question) =>
          limit(async () => {
            if (now() > startedAt + config.deadlineMs) return;
            escalated.push(question.questionId);
            const outcome = await runAgent(
              question,
              firstPass.get(question.questionId),
              alternatives.get(question.questionId),
              { gateway, toolbox, context: triage.context, catalog },
              { maxSteps: config.agentMaxSteps, reasoning: config.agentReasoning, maxTokens: config.agentMaxTokens, temperature: config.temperature, signal: escalationSignal },
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
      clearTimeout(budget);
    }
    await adjudication;

    // 6. Assemble with fallbacks: adjudication/agent → first pass (calc-corrected) → null,
    //    then recompute derived answers from their components' final values.
    const answers: Record<string, AnswerValue> = {};
    const answerTraces: Record<string, AnswerTrace> = {};
    const chosenAnswers = new Map<string, { candidate: Candidate | null; source: AnswerTrace["source"] }>();
    for (const question of questions) {
      const first = firstPass.get(question.questionId)!;
      chosenAnswers.set(
        question.questionId,
        final.get(question.questionId) ??
          (isPublishable(first)
            ? {
                candidate: first,
                source: escalated.includes(question.questionId) || adjudicated.includes(question.questionId) ? ("fallback_first_pass" as const) : ("first_pass" as const),
              }
            : { candidate: null, source: "unanswered" as const }),
      );
    }
    const finalCandidates = new Map<string, Candidate>();
    for (const [questionId, chosen] of chosenAnswers) if (chosen.candidate) finalCandidates.set(questionId, chosen.candidate);
    applyDerivations(questions, finalCandidates);
    for (const question of questions) {
      const first = firstPass.get(question.questionId)!;
      const chosen = chosenAnswers.get(question.questionId)!;
      const candidate = chosen.candidate;
      if (candidate?.flags.includes("derived") && !first.flags.includes("derived")) first.flags.push("derived");
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
      consistency,
      flags: Object.fromEntries([...firstPass].map(([questionId, candidate]) => [questionId, candidate.flags])),
      adjudicated,
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
        estimated: entry.estimated,
      })),
      durationMs: now() - startedAt,
    };
    return { output, trace };
  } finally {
    clearTimeout(hardStop);
  }
}
