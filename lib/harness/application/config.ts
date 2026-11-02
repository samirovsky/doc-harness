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
  /** Fire a duplicate of a model call still pending after this many ms (0 disables). */
  hedgeAfterMs: number;
}

export const defaultConfig: HarnessConfig = {
  batchSize: 6,
  concurrency: 10,
  dossierTokenBudget: 60_000,
  retrievalChunkTokens: 350,
  triage: true,
  answerReasoning: "low",
  answerMaxTokens: 8_000,
  escalation: true,
  escalationConfidence: 0.7,
  maxEscalations: 12,
  agentMaxSteps: 6,
  agentReasoning: "low",
  agentMaxTokens: 4_000,
  vision: true,
  temperature: 0,
  deadlineMs: 150_000,
  hedgeAfterMs: 12_000,
};

export function resolveConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return { ...defaultConfig, ...overrides };
}
