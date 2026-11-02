import type { CaseOutput, Question } from "../domain/contract";

export interface ScoreRow {
  questionId: string;
  question: string;
  submitted: unknown;
  expected: unknown;
  submittedSources: string[];
  expectedSources: string[];
  valueMatches: boolean;
  sourceMatches: boolean;
  correct: boolean;
}

/**
 * Same rule as the workspace UI (app/workspace/page.tsx): the value must match
 * with Object.is and, unless the expected value is null, at least one
 * submitted source must overlap the expected source set.
 */
export function scoreAgainstKey(output: CaseOutput, key: CaseOutput | { answers: CaseOutput["answers"] }, questions: Question[]) {
  const rows: ScoreRow[] = questions.map(({ questionId, question }) => {
    const submitted = output.answers[questionId];
    const expected = key.answers[questionId];
    const valueMatches = submitted !== undefined && expected !== undefined && Object.is(submitted.value, expected.value);
    const sourceMatches =
      submitted !== undefined &&
      expected !== undefined &&
      (expected.value === null || submitted.evidenceFileIds.some((fileId) => expected.evidenceFileIds.includes(fileId)));
    return {
      questionId,
      question,
      submitted: submitted?.value,
      expected: expected?.value,
      submittedSources: submitted?.evidenceFileIds ?? [],
      expectedSources: expected?.evidenceFileIds ?? [],
      valueMatches,
      sourceMatches,
      correct: valueMatches && sourceMatches,
    };
  });
  return { rows, correct: rows.filter((row) => row.correct).length, total: rows.length };
}
