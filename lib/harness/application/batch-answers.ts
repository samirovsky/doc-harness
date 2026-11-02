import type { Question } from "../domain/contract";
import { extractJsonObject } from "./json";
import type { RawAnswer } from "./reconcile";

/** Parses a batch response `{"answers":[...]}` (or an object keyed by questionId) into raw answers. */
export function parseBatchAnswers(content: string, batch: Question[]): Map<string, RawAnswer> {
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
