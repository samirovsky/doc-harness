import { documentText, type Corpus, type CorpusDocument } from "../domain/document";
import { estimateTokens } from "../domain/tokens";
import { extractJsonObject } from "./json";
import type { LlmGateway, Logger } from "./ports";
import { TRIAGE_SYSTEM, triageUserPrompt, type CaseContext } from "./prompts";

export type DocumentRole = "core" | "reference" | "archive";

export interface TriageResult {
  ok: boolean;
  roles: Map<string, DocumentRole>;
  reasons: Map<string, string>;
  context: CaseContext;
  error?: string;
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);

/** A compact profile: beginning, end and table samples — enough to judge authority. */
export function documentProfile(document: CorpusDocument): string {
  const text = documentText(document);
  const lines = [`### ${document.fileId} (${document.format}, ~${estimateTokens(text)} tokens)`, `Title: ${clip(document.title, 160)}`];
  const textBlocks = document.blocks.filter((block) => block.kind === "text");
  if (textBlocks.length) {
    const joined = textBlocks.map((block) => (block.kind === "text" ? block.text : "")).join("\n");
    lines.push(`Begins: ${clip(joined.slice(0, 700), 700)}`);
    if (joined.length > 900) lines.push(`Ends: ${joined.slice(-300)}`);
  }
  for (const block of document.blocks.filter((candidate) => candidate.kind === "table").slice(0, 6)) {
    if (block.kind !== "table") continue;
    const sample = block.rows.slice(0, 2).map((row) => clip(row.join(" | "), 300));
    const last = block.rows.length > 3 ? [`… last: ${clip(block.rows[block.rows.length - 1].join(" | "), 300)}`] : [];
    lines.push(`Table "${block.locator}" (${block.rows.length} rows): ${clip(block.header.join(" | "), 300)}`, ...sample.map((row) => `  ${row}`), ...last.map((row) => `  ${row}`));
  }
  if (document.warnings.length) lines.push(`Warnings: ${document.warnings.join("; ")}`);
  return lines.join("\n");
}

const ROLES = new Set<DocumentRole>(["core", "reference", "archive"]);

/**
 * One model call classifies document authority. Fail-open by design: any
 * error, or any document the model omits, keeps the document in the dossier.
 */
export async function triageDocuments(
  corpus: Corpus,
  gateway: LlmGateway,
  options: { reasoning: "off" | "low" | "medium" | "high"; temperature: number; logger: Logger; signal?: AbortSignal },
): Promise<TriageResult> {
  const fileIds = corpus.documents.map((document) => document.fileId);
  const roles = new Map<string, DocumentRole>(fileIds.map((fileId) => [fileId, "core"]));
  const reasons = new Map<string, string>();
  try {
    const response = await gateway.complete(
      {
        purpose: "triage",
        json: true,
        reasoning: options.reasoning,
        temperature: options.temperature,
        maxTokens: 4_000,
        messages: [
          { role: "system", content: TRIAGE_SYSTEM },
          { role: "user", content: triageUserPrompt(corpus.documents.map(documentProfile).join("\n\n")) },
        ],
        meta: { fileIds },
      },
      options.signal,
    );
    const parsed = extractJsonObject(response.content) as {
      caseContext?: { subject?: unknown; asOfDate?: unknown };
      documents?: { fileId?: unknown; role?: unknown; reason?: unknown }[];
    };
    for (const entry of parsed.documents ?? []) {
      const fileId = String(entry.fileId ?? "");
      const role = String(entry.role ?? "").toLowerCase() as DocumentRole;
      if (!roles.has(fileId) || !ROLES.has(role)) continue;
      roles.set(fileId, role);
      if (entry.reason) reasons.set(fileId, String(entry.reason).slice(0, 160));
    }
    const subject = typeof parsed.caseContext?.subject === "string" ? parsed.caseContext.subject : null;
    const asOf = typeof parsed.caseContext?.asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.caseContext.asOfDate)
      ? parsed.caseContext.asOfDate
      : null;
    // Never exclude everything: if the model archived every file, fail open.
    if ([...roles.values()].every((role) => role === "archive")) {
      for (const fileId of fileIds) roles.set(fileId, "core");
    }
    return { ok: true, roles, reasons, context: { subject, asOfDate: asOf } };
  } catch (error) {
    options.logger.warn(`triage failed, keeping every document: ${(error as Error).message}`);
    return { ok: false, roles, reasons, context: { subject: null, asOfDate: null }, error: (error as Error).message };
  }
}
