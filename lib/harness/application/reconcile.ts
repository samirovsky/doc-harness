import { ArithmeticError, evaluateArithmetic, evaluateWithReferences, expressionReferences, hasReferences } from "../domain/arithmetic";
import { canonicalize, cleanNumber } from "../domain/canonicalize";
import type { AnswerScalar, Question } from "../domain/contract";
import { documentText, type CorpusDocument } from "../domain/document";

/** What the model proposed for one question (first pass or agent). */
export interface RawAnswer {
  questionId: string;
  value: unknown;
  calc?: string | null;
  evidenceFileIds?: unknown;
  confidence?: unknown;
  rationale?: unknown;
}

export type Flag =
  | "missing"
  | "invalid_value"
  | "calc_mismatch"
  | "calc_invalid"
  | "low_confidence"
  | "no_evidence"
  | "grounded_evidence"
  | "disagreement"
  | "derived";

/** Flags that justify spending an agent escalation. */
export const ESCALATION_FLAGS: Flag[] = ["missing", "invalid_value", "disagreement", "calc_mismatch", "no_evidence", "low_confidence"];

export interface Candidate {
  questionId: string;
  value: AnswerScalar;
  evidenceFileIds: string[];
  flags: Flag[];
  confidence: number | null;
  rationale: string;
  calc: string | null;
}

export interface ReconcileContext {
  /** fileIds that may be cited (the manifest). */
  fileIds: string[];
  /** Documents that may ground evidence when the model cites none (non-archive). */
  groundingDocuments: CorpusDocument[];
  escalationConfidence: number;
}

/** Maps model-cited ids onto real fileIds: exact, case-insensitive, extension-less, or decorated ("x.pdf p.2"). */
export function normalizeEvidence(cited: unknown, fileIds: string[]): string[] {
  const list = Array.isArray(cited) ? cited : typeof cited === "string" ? cited.split(/[,;]/) : [];
  const byLower = new Map(fileIds.map((fileId) => [fileId.toLowerCase(), fileId]));
  const byStem = new Map(fileIds.map((fileId) => [fileId.toLowerCase().replace(/\.[a-z0-9]+$/, ""), fileId]));
  const resolved: string[] = [];
  for (const entry of list) {
    const raw = String(entry ?? "").trim().replace(/^["'`]|["'`]$/g, "");
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const candidates = [lower, lower.split(/[\s#(@]/)[0], lower.replace(/\.[a-z0-9]+$/, "")];
    let match: string | undefined;
    for (const candidate of candidates) {
      match = byLower.get(candidate) ?? byStem.get(candidate) ?? byStem.get(candidate.replace(/\.[a-z0-9]+$/, ""));
      if (match) break;
    }
    if (match && !resolved.includes(match)) resolved.push(match);
  }
  return resolved;
}

function numberVariants(value: number): string[] {
  const variants = new Set([String(value), value.toLocaleString("en-US")]);
  if (Number.isInteger(value)) variants.add(value.toLocaleString("en-US").replace(/,/g, " "));
  return [...variants];
}

/** Finds documents literally containing the answer value (used only when the model cited nothing). */
export function groundEvidence(value: AnswerScalar, documents: CorpusDocument[]): string[] {
  if (value === null || typeof value === "boolean") return [];
  const patterns =
    typeof value === "number"
      ? numberVariants(Math.abs(value)).map((variant) => new RegExp(`(^|[^\\d.,])${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d]|[.,]\\d)`))
      : [new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")];
  const hits = documents.filter((document) => {
    const text = documentText(document);
    return patterns.some((pattern) => pattern.test(text));
  });
  return hits.length > 0 && hits.length <= 3 ? hits.map((document) => document.fileId) : [];
}

function confidenceOf(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return null;
  return value > 1 ? Math.min(1, value / 100) : Math.max(0, value);
}

/**
 * Deterministic post-processing of a model answer: canonical value, code-
 * evaluated arithmetic, evidence normalization/grounding, and flags that
 * decide escalation.
 */
export function reconcile(question: Question, raw: RawAnswer | undefined, context: ReconcileContext): Candidate {
  if (!raw) {
    return { questionId: question.questionId, value: null, evidenceFileIds: [], flags: ["missing"], confidence: null, rationale: "", calc: null };
  }
  const flags: Flag[] = [];
  const canonical = canonicalize(raw.value, question.answerType);
  let value: AnswerScalar = canonical.ok ? canonical.value : null;
  if (!canonical.ok) flags.push("invalid_value");

  const calc = typeof raw.calc === "string" && raw.calc.trim() ? raw.calc.trim() : null;
  // Calcs referencing other questions are resolved after all answers are final (see applyDerivations).
  if (calc && question.answerType === "number" && !hasReferences(calc)) {
    try {
      const computed = cleanNumber(evaluateArithmetic(calc));
      if (value === null || typeof value !== "number") {
        if (!canonical.ok) {
          value = computed;
          flags.splice(flags.indexOf("invalid_value"), 1);
        }
      } else if (Math.abs(computed - value) > 1e-9 * Math.max(1, Math.abs(value))) {
        flags.push("calc_mismatch");
        value = computed;
      }
    } catch (error) {
      if (error instanceof ArithmeticError) flags.push("calc_invalid");
      else throw error;
    }
  }

  const confidence = confidenceOf(raw.confidence);
  let evidenceFileIds = value === null ? [] : normalizeEvidence(raw.evidenceFileIds, context.fileIds);
  if (value !== null && evidenceFileIds.length === 0) {
    evidenceFileIds = groundEvidence(value, context.groundingDocuments);
    flags.push(evidenceFileIds.length ? "grounded_evidence" : "no_evidence");
  }
  if (confidence !== null && confidence < context.escalationConfidence) flags.push("low_confidence");

  return {
    questionId: question.questionId,
    value,
    evidenceFileIds,
    flags,
    confidence,
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 400) : "",
    calc,
  };
}

/** A candidate is publishable when its value is canonical and a non-null value has evidence. */
export function isPublishable(candidate: Candidate): boolean {
  if (candidate.flags.includes("missing") || candidate.flags.includes("invalid_value")) return false;
  return candidate.value === null || candidate.evidenceFileIds.length > 0;
}

export function needsEscalation(candidate: Candidate): boolean {
  return candidate.flags.some((flag) => ESCALATION_FLAGS.includes(flag));
}

/**
 * Derivation consistency: a number answer whose calc references other
 * questions (e.g. "q_012 - q_013") is recomputed from their final values, so
 * a derived figure can never contradict its components. Its evidence gains
 * the components' evidence. Repeats to resolve chains; skips cycles and
 * unresolved references.
 */
export function applyDerivations(questions: Question[], candidates: Map<string, Candidate>): void {
  const types = new Map(questions.map((question) => [question.questionId, question.answerType]));
  for (let round = 0; round < 3; round += 1) {
    let changed = false;
    for (const [questionId, candidate] of candidates) {
      if (types.get(questionId) !== "number" || !candidate.calc) continue;
      const references = expressionReferences(candidate.calc, [...types.keys()]);
      if (references.length === 0 || references.includes(questionId)) continue;
      const values = new Map<string, number>();
      for (const id of references) {
        const component = candidates.get(id)?.value;
        if (typeof component === "number") values.set(id, component);
      }
      let value: number;
      try {
        value = cleanNumber(evaluateWithReferences(candidate.calc, values));
      } catch {
        continue;
      }
      if (Object.is(value, candidate.value)) continue;
      candidate.value = value;
      if (!candidate.flags.includes("derived")) candidate.flags.push("derived");
      for (const id of references) {
        for (const fileId of candidates.get(id)?.evidenceFileIds ?? []) {
          if (!candidate.evidenceFileIds.includes(fileId)) candidate.evidenceFileIds.push(fileId);
        }
      }
      changed = true;
    }
    if (!changed) break;
  }
}
