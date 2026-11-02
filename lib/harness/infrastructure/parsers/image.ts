import type { CorpusDocument } from "../../domain/document";
import type { OcrEngine } from "../ocr/types";
import { cleanText } from "./xml";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export function imageMimeType(fileName: string): string | null {
  return MIME[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export interface ImageParseOptions {
  /** Below this OCR confidence the raw image is retained for the vision fallback. */
  visionBelowConfidence: number;
  /** Images larger than this are never inlined for vision (prompt size guard). */
  maxInlineBytes: number;
}

export async function parseImage(
  fileId: string,
  bytes: Uint8Array,
  ocr: OcrEngine,
  options: ImageParseOptions,
): Promise<CorpusDocument> {
  const mimeType = imageMimeType(fileId) ?? "image/png";
  const result = await ocr.recognize(bytes);
  const text = cleanText(result.text);
  const weak = result.confidence < options.visionBelowConfidence || text.replace(/\W/g, "").length < 20;
  const document: CorpusDocument = {
    fileId,
    format: "image",
    title: text.split("\n").slice(0, 2).join(" — ") || fileId,
    blocks: [{ kind: "text", locator: "image text (OCR)", text: text || "[no text recognized]" }],
    ocr: { engine: result.engine, confidence: Math.round(result.confidence * 10) / 10 },
    warnings: weak ? [`ocr: low confidence ${result.confidence.toFixed(1)}`] : [],
  };
  if (weak && bytes.byteLength <= options.maxInlineBytes) {
    document.image = { mimeType, base64: Buffer.from(bytes).toString("base64") };
  }
  return document;
}
