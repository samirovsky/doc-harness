/**
 * Normalized representation of one evidence file. Every parser (CSV, PDF,
 * DOCX, PPTX, XLSX, image/OCR) produces this shape, so the answering core is
 * format-agnostic.
 */
export interface TextBlock {
  kind: "text";
  /** Human-readable position, e.g. "page 2", "slide 4", "notes slide 4". */
  locator: string;
  text: string;
}

export interface TableBlock {
  kind: "table";
  /** e.g. "sheet Assets", "slide 3 table 1", "table 2". */
  locator: string;
  header: string[];
  rows: string[][];
}

export type Block = TextBlock | TableBlock;

export interface OcrInfo {
  engine: string;
  /** 0–100 mean word confidence reported by the OCR engine. */
  confidence: number;
}

export interface EmbeddedImage {
  mimeType: string;
  base64: string;
}

export interface CorpusDocument {
  fileId: string;
  format: string;
  title: string;
  blocks: Block[];
  ocr?: OcrInfo;
  /** Raw image bytes, kept only for images whose OCR is too weak to trust. */
  image?: EmbeddedImage;
  warnings: string[];
}

export interface Corpus {
  documents: CorpusDocument[];
}

export function textDocument(fileId: string, format: string, text: string): CorpusDocument {
  return {
    fileId,
    format,
    title: firstLine(text) || fileId,
    blocks: [{ kind: "text", locator: "body", text }],
    warnings: [],
  };
}

export function tableToText(block: TableBlock): string {
  const lines = [block.header.join(" | ")];
  for (const row of block.rows) lines.push(row.join(" | "));
  return lines.join("\n");
}

export function blockText(block: Block): string {
  return block.kind === "text" ? block.text : tableToText(block);
}

/** Plain text of the whole document (used for search and grounding). */
export function documentText(document: CorpusDocument): string {
  return document.blocks.map(blockText).join("\n");
}

/** Compact, citation-friendly rendering used inside prompts. */
export function renderDocument(document: CorpusDocument, blocks: Block[] = document.blocks): string {
  const attributes = [`id="${document.fileId}"`, `format="${document.format}"`];
  if (document.ocr) attributes.push(`ocr_confidence="${Math.round(document.ocr.confidence)}"`);
  const body = blocks
    .map((block) => {
      const heading = block.kind === "table" ? `[${block.locator} · table]` : `[${block.locator}]`;
      return `${heading}\n${blockText(block)}`;
    })
    .join("\n\n");
  return `<document ${attributes.join(" ")}>\n${body}\n</document>`;
}

function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim().length > 0) ?? "").trim().slice(0, 160);
}
