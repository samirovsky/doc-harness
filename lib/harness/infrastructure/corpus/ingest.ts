import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Corpus, CorpusDocument } from "../../domain/document";
import { TesseractOcr } from "../ocr/tesseract";
import type { OcrEngine } from "../ocr/types";
import { parseCsvText } from "../parsers/csv";
import { parseDocx } from "../parsers/docx";
import { imageMimeType, parseImage } from "../parsers/image";
import { parsePdf } from "../parsers/pdf";
import { parsePptx } from "../parsers/pptx";
import { parseXlsx } from "../parsers/xlsx";

/** Bump whenever parser output changes, to invalidate on-disk caches. */
export const PARSER_VERSION = "6";

export interface IngestOptions {
  manifestPath: string;
  filesDir: string;
  /** Content-addressed cache directory (never committed). Omit to disable caching. */
  cacheDir?: string;
  ocr?: OcrEngine;
  /** OCR confidence under which the raw image is kept for a vision fallback. */
  visionBelowConfidence?: number;
  concurrency?: number;
  log?: (message: string) => void;
}

export interface IngestReportEntry {
  fileId: string;
  format: string;
  fromCache: boolean;
  ms: number;
  warnings: string[];
}

export interface IngestionResult {
  caseId: string | null;
  manifestFileIds: string[];
  corpus: Corpus;
  report: IngestReportEntry[];
  totalMs: number;
}

interface ManifestEntry {
  fileId: string;
  format?: string;
}

async function readManifest(manifestPath: string, filesDir: string): Promise<{ caseId: string | null; files: ManifestEntry[] }> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { caseId?: string; files?: ManifestEntry[] };
    if (Array.isArray(manifest.files) && manifest.files.length > 0) {
      return { caseId: manifest.caseId ?? null, files: manifest.files.filter((file) => typeof file.fileId === "string") };
    }
  } catch {
    // Fall through to directory discovery.
  }
  const names = (await readdir(filesDir)).filter((name) => !name.startsWith(".")).sort();
  return { caseId: null, files: names.map((fileId) => ({ fileId })) };
}

export function detectFormat(fileId: string, declared?: string): string {
  const extension = path.extname(fileId).slice(1).toLowerCase();
  if (imageMimeType(fileId) || ["png", "jpg", "jpeg", "image"].includes((declared ?? "").toLowerCase())) return "image";
  if (["csv", "tsv"].includes(extension)) return "csv";
  if (["xlsx", "xlsm"].includes(extension)) return "xlsx";
  if (["pdf", "docx", "pptx"].includes(extension)) return extension;
  if (["txt", "md", "json", "xml", "html", "htm"].includes(extension)) return "text";
  return (declared ?? extension ?? "unknown").toLowerCase();
}

async function parseOne(
  fileId: string,
  format: string,
  bytes: Uint8Array,
  ocr: () => OcrEngine,
  visionBelowConfidence: number,
): Promise<CorpusDocument> {
  switch (format) {
    case "csv":
      return parseCsvText(fileId, new TextDecoder().decode(bytes));
    case "pdf":
      return parsePdf(fileId, bytes);
    case "xlsx":
      return parseXlsx(fileId, bytes);
    case "docx":
      return parseDocx(fileId, bytes, ocr());
    case "pptx":
      return parsePptx(fileId, bytes, ocr());
    case "image":
      return parseImage(fileId, bytes, ocr(), { visionBelowConfidence, maxInlineBytes: 4_000_000 });
    case "text": {
      const text = new TextDecoder().decode(bytes);
      return { fileId, format, title: fileId, blocks: [{ kind: "text", locator: "body", text }], warnings: [] };
    }
    default:
      return { fileId, format, title: fileId, blocks: [], warnings: [`unsupported format "${format}"`] };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Discovers files through the manifest (directory listing as fallback),
 * parses each one by format, and caches the normalized document under a key
 * derived from the file's content hash — renaming or replacing files can
 * never serve stale content.
 */
export async function ingestDataRoom(options: IngestOptions): Promise<IngestionResult> {
  const startedAt = Date.now();
  const log = options.log ?? (() => {});
  const visionBelowConfidence = options.visionBelowConfidence ?? 60;
  const { caseId, files } = await readManifest(options.manifestPath, options.filesDir);
  if (options.cacheDir) await mkdir(options.cacheDir, { recursive: true });

  // OCR workers start lazily, only if the data room contains images.
  const owned: { ocr: TesseractOcr | null } = { ocr: null };
  const ocr = () => options.ocr ?? (owned.ocr ??= new TesseractOcr());

  try {
    const entries = await mapLimit(files, options.concurrency ?? 6, async (entry) => {
      const fileStartedAt = Date.now();
      const format = detectFormat(entry.fileId, entry.format);
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await readFile(path.join(options.filesDir, entry.fileId)));
      } catch (error) {
        const warning = `missing file: ${(error as Error).message}`;
        const document: CorpusDocument = { fileId: entry.fileId, format, title: entry.fileId, blocks: [], warnings: [warning] };
        return { document, report: { fileId: entry.fileId, format, fromCache: false, ms: 0, warnings: [warning] } };
      }
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
      const cacheFile = options.cacheDir
        ? path.join(options.cacheDir, `v${PARSER_VERSION}-${format}-${hash}.json`)
        : null;

      if (cacheFile) {
        try {
          const cached = JSON.parse(await readFile(cacheFile, "utf8")) as CorpusDocument;
          const document = { ...cached, fileId: entry.fileId };
          return { document, report: { fileId: entry.fileId, format, fromCache: true, ms: Date.now() - fileStartedAt, warnings: document.warnings } };
        } catch {
          // Cache miss.
        }
      }

      let document: CorpusDocument;
      try {
        document = await parseOne(entry.fileId, format, bytes, ocr, visionBelowConfidence);
      } catch (error) {
        document = { fileId: entry.fileId, format, title: entry.fileId, blocks: [], warnings: [`parse failed: ${(error as Error).message}`] };
      }
      if (cacheFile && document.blocks.length > 0) {
        const temporary = `${cacheFile}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(document));
        await rename(temporary, cacheFile);
      }
      const ms = Date.now() - fileStartedAt;
      log(`parsed ${entry.fileId} (${format}) in ${ms} ms${document.warnings.length ? ` — ${document.warnings.join("; ")}` : ""}`);
      return { document, report: { fileId: entry.fileId, format, fromCache: false, ms, warnings: document.warnings } };
    });

    return {
      caseId,
      manifestFileIds: files.map((file) => file.fileId),
      corpus: { documents: entries.map((entry) => entry.document) },
      report: entries.map((entry) => entry.report),
      totalMs: Date.now() - startedAt,
    };
  } finally {
    await owned.ocr?.close();
  }
}
