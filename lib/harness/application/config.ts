import type { ReasoningEffort } from "./ports";

/** Tunable knobs; defaults were chosen on the practice case (see README). */
export interface HarnessConfig {
  /** Questions per answer call. Smaller = more parallel, more prompt tokens. */
  batchSize: number;
  /** Max concurrent model calls. */
  concurrency: number;
  /** Above this many tokens of non-archive documents, switch to BM25-retrieved dossiers. */
  dossierTokenBudget: number;
  /** Target size of retrieval chunks (tokens). */
  retrievalChunkTokens: number;
  /** Run the authority triage call. When false, every document is kept. */
  triage: boolean;
  answerReasoning: ReasoningEffort;
  answerMaxTokens: number;
  /** Run an independent second answer pass and escalate disagreements. */
  consistency: boolean;
  /** Sampling temperature of the second pass (diversity vs. pass 1). */
  consistencyTemperature: number;
  /** How long to wait for unfinished second-pass batches once pass 1 is done. */
  consistencyGraceMs: number;
  /** Wall-clock budget for settling disagreements (one adjudication call each). */
  adjudicationBudgetMs: number;
  /** Escalate flagged answers to the tool-using agent. */
  escalation: boolean;
  /** First-pass confidence under which an answer is escalated. */
  escalationConfidence: number;
  /** Upper bound on escalated questions per run (cost guard). */
  maxEscalations: number;
  agentMaxSteps: number;
  agentReasoning: ReasoningEffort;
  agentMaxTokens: number;
  /** Transcribe images with weak OCR through the model's vision input. */
  vision: boolean;
  temperature: number;
  /** Soft deadline for the whole run; escalations are skipped once it passes. */
  deadlineMs: number;
  /** Wall-clock budget of the escalation phase; agents still running are abandoned. */
  escalationBudgetMs: number;
  /** Fire the k-th duplicate of a model call still pending after k × this many ms (0 disables). */
  hedgeAfterMs: number;
  /** Maximum duplicates per model call. */
  maxHedges: number;
  /** Reasoning effort of hedge copies (null = same as the original call). */
  hedgeReasoning: ReasoningEffort | null;
}

export const defaultConfig: HarnessConfig = {
  batchSize: 6,
  concurrency: 20,
  dossierTokenBudget: 60_000,
  retrievalChunkTokens: 350,
  triage: true,
  answerReasoning: "low",
  answerMaxTokens: 8_000,
  consistency: true,
  consistencyTemperature: 0.7,
  consistencyGraceMs: 5_000,
  adjudicationBudgetMs: 40_000,
  escalation: true,
  escalationConfidence: 0.5,
  maxEscalations: 12,
  agentMaxSteps: 6,
  agentReasoning: "low",
  agentMaxTokens: 4_000,
  vision: true,
  temperature: 0,
  deadlineMs: 150_000,
  escalationBudgetMs: 20_000,
  hedgeAfterMs: 7_000,
  maxHedges: 2,
  hedgeReasoning: "off",
};

export function resolveConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return { ...defaultConfig, ...overrides };
}
