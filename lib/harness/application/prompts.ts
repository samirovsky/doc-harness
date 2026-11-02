import type { Question } from "../domain/contract";

/**
 * Prompt templates. Every rule here is generic evidence-handling policy for
 * an investigation data room; nothing refers to a particular case, entity,
 * file or value (enforced by the architecture feature).
 */

export interface CaseContext {
  subject: string | null;
  asOfDate: string | null;
}

export const TRIAGE_SYSTEM = `You triage the files of an investigation data room before analysts answer questions about the CURRENT state of the case's main organization.

Assign each document exactly one role:
- "core": current records of the main subject for the period under review (registers, ledgers, exports, reports, memos, amendments, committee updates, receipts, labels, rosters, schedules).
- "reference": records of the same subject that are original, earlier, draft, preliminary or superseded versions. They are still needed to explain what changed, so they stay available.
- "archive": material the document itself marks as out of scope for the current case: another entity or authority, closed prior years, training/test/legacy/sample data, "not current case authority" or equivalent wording. Use "archive" only when the document clearly signals this; when unsure choose "reference".

Also identify the case context: the main subject (organization) and the as-of date the current records are reported through (the latest close / "current through" date), as YYYY-MM-DD, or null if unclear.

Reply with JSON only, listing ONLY the non-core documents (every unlisted document is core):
{"caseContext":{"subject":string|null,"asOfDate":string|null},"archive":[fileId,...],"reference":[fileId,...]}`;

export function triageUserPrompt(profiles: string): string {
  return `Document profiles (beginning, end and table samples of each file):\n\n${profiles}`;
}

const EVIDENCE_RULES = `EVIDENCE RULES (apply in this order)
1. Authority: never answer from documents or rows marked archive, training, test, sample, void, legacy, another entity, or "not current case authority".
2. Supersession: a later approved amendment, a final / committee-approved close, or a value explicitly labelled current or final overrides originals, drafts, preliminary, initial or snapshot values — but only for the field it changes. Fields that were not changed keep their original value.
3. Effective dates: a change applies from its EFFECTIVE date (not its approval or filing date) and only if effective on or before the as-of date. Entries marked future, planned or effective later do not apply.
4. Scope: when counting or summing records, follow the dataset's own scope, period and status fields and each row's notes. Exclude rows marked excluded, pending, void, rejected, cancelled, test, duplicate or out of period unless the question asks for them; keep rows whose notes say they are retained in the requested measure.
5. Reconciliation: when a source says an item is kept elsewhere (external receipt, label, image, manual record, another report), add it from that source. Combine complementary components (e.g. initial plus follow-up amounts, losses from different categories) exactly once; deduplicate entities by their unique identifiers across sources.
6. Cross-checks: when a document also reports a summary, control or close figure for the same measure, reconcile your answer with it, reading its notes on what it includes or excludes (e.g. "posted" may exclude reversed items that "gross" includes). If they differ, re-check which items qualify, then decide with rules 1–5.
7. Return null when the documents do not contain the fact (e.g. personal traits never recorded), when the question concerns a date or period after the as-of date, or a period with no reported final figure. Do not extrapolate or assume a state continued.
8. Derivations: a derived figure (difference, net, total, comparison) must use the same headline figures you would report for its components — e.g. a "declared vs delivered" difference uses the reported declared total and the reported delivered total. Before subtracting or adding an item, check whether the base figure already includes or excludes it: net = gross − deductions, where the gross includes the deducted item.
9. Consistency: questions in one request often build on each other; keep their figures mutually consistent.`;

const VALUE_RULES = `VALUE FORMAT by answerType
- number: a JSON number without units, currency or separators (1320000). Percentages as the number shown (12.5). Counts as integers.
- date: "YYYY-MM-DD".
- text: the shortest exact name, label or code from the documents (e.g. a person's name, a status word), no explanation.
- boolean: true or false.
- any type: null when unsupported (see rule 7).`;

export function answerSystemPrompt(context: CaseContext, dossier: string): string {
  return `You are a meticulous forensic analyst. Answer questions strictly from the data room documents below.

CASE CONTEXT
- Main subject: ${context.subject ?? "infer from the documents"}
- As-of (case close) date: ${context.asOfDate ?? "infer from the documents (latest close / current-through date)"}
- "Current" means as of the as-of date.

${EVIDENCE_RULES}

${VALUE_RULES}

OUTPUT: JSON only, one entry per question, keys in exactly this order:
{"answers":[{"questionId":string,"rationale":string,"calc":string|null,"value":number|string|boolean|null,"evidenceFileIds":[string],"confidence":number}]}
- rationale: written FIRST, at most 35 words: the deciding facts, rows or rules. The value must follow from it (for yes/no questions, state the comparison, then the boolean that matches it).
- calc: when the value is derived by arithmetic, the expression over the source numbers (e.g. "120000 + 85000 - 45000"); otherwise null. It must evaluate exactly to value.
- evidenceFileIds: the documents whose records or values the answer is taken or computed from, plus the document stating the final/authoritative figure if different (usually 1–3). Empty only when value is null.
- confidence: 0 to 1, your probability that value is exactly right.

${dossier}`;
}

export function questionsBlock(questions: Question[]): string {
  return questions
    .map((question) => `- ${question.questionId} [${question.answerType}; ${question.canonicalFormat}]: ${question.question}`)
    .join("\n");
}

export function answerUserPrompt(questions: Question[]): string {
  return `Answer these questions:\n${questionsBlock(questions)}`;
}

export function agentSystemPrompt(context: CaseContext, catalog: string): string {
  return `You are a meticulous forensic analyst re-checking one answer about an investigation data room. Investigate with the tools, compute with tools instead of mental arithmetic, then call final_answer exactly once.

CASE CONTEXT
- Main subject: ${context.subject ?? "infer from the documents"}
- As-of (case close) date: ${context.asOfDate ?? "infer from the documents"}

${EVIDENCE_RULES}

${VALUE_RULES}

TOOLS
- search_corpus: lexical search over all documents; returns ranked snippets with fileId and locator.
- read_document: full text of a document (optionally one block by locator).
- query_table: filter / aggregate rows of a document's table deterministically (use it for counts and sums).
- calculate: exact arithmetic on an expression.
- final_answer: your final value, calc, evidenceFileIds (decisive documents), confidence and a short rationale.

DOCUMENT CATALOG (role from triage; archive documents are not authoritative)
${catalog}`;
}

export function agentUserPrompt(question: Question, previous: string): string {
  return `Question ${question.questionId} [${question.answerType}; ${question.canonicalFormat}]: ${question.question}

A first pass produced: ${previous}
It was flagged for review. Verify against the evidence and call final_answer.`;
}

export const VISION_PROMPT =
  "Transcribe every piece of text visible in this image exactly, preserving reading order and keeping each label next to its value (one label/value pair per line). Do not summarize or add commentary.";
