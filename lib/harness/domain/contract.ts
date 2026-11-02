/**
 * Input/output contract of the case runner, mirrored structurally from
 * `lib/challenge/types.ts` so the domain stays free of outer-layer imports.
 * The composition roots assert assignability between the two at compile time.
 */
export type AnswerType = "number" | "date" | "text" | "boolean";

export type AnswerScalar = number | string | boolean | null;

export interface Question {
  questionId: string;
  question: string;
  answerType: AnswerType;
  canonicalFormat: string;
}

export interface CaseInput {
  caseId: string;
  questions: Question[];
}

export interface AnswerValue {
  value: AnswerScalar;
  evidenceFileIds: string[];
}

export interface CaseOutput {
  caseId: string;
  estimatedCostUsd: number;
  answers: Record<string, AnswerValue>;
}
