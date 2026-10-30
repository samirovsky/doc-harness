export type AnswerType = "number" | "date" | "text" | "boolean";

export interface PlaybookQuestion {
  questionId: string;
  question: string;
  answerType: AnswerType;
  canonicalFormat: string;
}

export interface CaseInput {
  caseId: string;
  questions: PlaybookQuestion[];
}

export interface AnswerValue {
  value: number | string | boolean | null;
  /** One or more files where the information originated. */
  evidenceFileIds: string[];
}

export interface CaseOutput {
  caseId: string;
  /** Candidate-calculated total estimated OpenRouter cost for the complete run. */
  estimatedCostUsd: number;
  /** Answers keyed by the corresponding question ID. */
  answers: Record<string, AnswerValue>;
}
