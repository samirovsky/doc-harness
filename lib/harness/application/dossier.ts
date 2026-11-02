import { Bm25Index, chunkDocuments, type Chunk } from "../domain/bm25";
import type { Question } from "../domain/contract";
import { renderDocument, type Corpus, type CorpusDocument } from "../domain/document";
import { estimateTokens } from "../domain/tokens";
import type { TriageResult } from "./triage";

export interface DossierPlan {
  mode: "full" | "retrieval";
  included: CorpusDocument[];
  excludedIndex: string;
  /** Full mode: the stable rendered dossier shared by every batch (cache-friendly prefix). */
  fullText?: string;
  fullTokens?: number;
  index?: Bm25Index;
  budget: number;
}

export interface Dossier {
  mode: "full" | "retrieval";
  text: string;
  tokens: number;
  fileIds: string[];
}

function excludedIndex(corpus: Corpus, triage: TriageResult): string {
  const excluded = corpus.documents.filter((document) => triage.roles.get(document.fileId) === "archive");
  if (excluded.length === 0) return "";
  const lines = excluded.map(
    (document) => `- ${document.fileId}: archive — ${triage.reasons.get(document.fileId) ?? "not authoritative for this case"}`,
  );
  return `<excluded_documents>\nThese files were triaged as non-authoritative archives and are not shown. Do not cite them.\n${lines.join("\n")}\n</excluded_documents>`;
}

/**
 * Decides once per run how documents reach the answer prompts: the full set of
 * non-archive documents when it fits the token budget (a stable, cacheable
 * prefix), otherwise BM25-retrieved chunks selected per batch of questions.
 */
export function planDossier(corpus: Corpus, triage: TriageResult, budget: number, chunkTokens: number): DossierPlan {
  const included = corpus.documents
    .filter((document) => triage.roles.get(document.fileId) !== "archive")
    .sort((left, right) => left.fileId.localeCompare(right.fileId));
  const excluded = excludedIndex(corpus, triage);
  const rendered = included.map((document) => renderDocument(document));
  const fullTokens = rendered.reduce((total, text) => total + estimateTokens(text), 0);
  if (fullTokens <= budget) {
    return { mode: "full", included, excludedIndex: excluded, fullText: rendered.join("\n\n"), fullTokens, budget };
  }
  return { mode: "retrieval", included, excludedIndex: excluded, index: new Bm25Index(chunkDocuments(included, chunkTokens)), budget };
}

function wrap(body: string, excluded: string): string {
  return `<documents>\n${body}\n</documents>${excluded ? `\n\n${excluded}` : ""}`;
}

export function dossierForBatch(plan: DossierPlan, questions: Question[]): Dossier {
  if (plan.mode === "full") {
    return {
      mode: "full",
      text: wrap(plan.fullText ?? "", plan.excludedIndex),
      tokens: plan.fullTokens ?? 0,
      fileIds: plan.included.map((document) => document.fileId),
    };
  }

  // Round-robin over each question's ranked chunks so every question gets context.
  const rankings = questions.map((question) => plan.index!.search(question.question, 40).map((hit) => hit.chunk));
  const selected = new Map<string, Chunk>();
  let tokens = 0;
  const overhead = (fileId: string) =>
    [...selected.values()].some((chunk) => chunk.fileId === fileId) ? 12 : estimateTokens(`<document id="${fileId}" format="">\n</document>\n\n`) + 12;
  for (let rank = 0; rank < 40; rank += 1) {
    let progressed = false;
    for (const ranking of rankings) {
      const chunk = ranking[rank];
      if (!chunk || selected.has(chunk.id)) continue;
      progressed = true;
      const cost = chunk.tokens + overhead(chunk.fileId);
      if (tokens + cost > plan.budget) continue;
      selected.set(chunk.id, chunk);
      tokens += cost;
    }
    if (!progressed) break;
  }

  const render = (chunks: Chunk[]) => {
    const byDocument = new Map<string, Chunk[]>();
    for (const chunk of chunks) byDocument.set(chunk.fileId, [...(byDocument.get(chunk.fileId) ?? []), chunk]);
    const body = [...byDocument.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fileId, documentChunks]) => {
        const document = plan.included.find((candidate) => candidate.fileId === fileId)!;
        const excerpts = documentChunks.map((chunk) => `[${chunk.locator} · excerpt]\n${chunk.text}`).join("\n\n");
        return `<document id="${fileId}" format="${document.format}">\n${excerpts}\n</document>`;
      })
      .join("\n\n");
    return { body, fileIds: [...byDocument.keys()] };
  };

  // The selection used estimates; drop lowest-priority chunks until the rendering fits.
  const chunks = [...selected.values()];
  let rendered = render(chunks);
  while (chunks.length > 0 && estimateTokens(rendered.body) > plan.budget) {
    chunks.pop();
    rendered = render(chunks);
  }
  return { mode: "retrieval", text: wrap(rendered.body, plan.excludedIndex), tokens: estimateTokens(rendered.body), fileIds: rendered.fileIds };
}
