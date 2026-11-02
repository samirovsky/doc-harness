/**
 * Debug CLI: ingests the data room and prints the normalized documents.
 *   npm run harness:ingest                 # summary table
 *   npm run harness:ingest -- <fileId>     # full rendering of one document
 */
import path from "node:path";
import { renderDocument } from "../lib/harness/domain/document";
import { estimateTokens } from "../lib/harness/domain/tokens";
import { ingestDataRoom } from "../lib/harness/infrastructure/corpus/ingest";

const root = path.resolve(import.meta.dirname, "..");
const result = await ingestDataRoom({
  manifestPath: path.join(root, "data/case/manifest.json"),
  filesDir: path.join(root, "data/case/files"),
  cacheDir: path.join(root, ".cache/doc-harness"),
  log: (message) => console.error(message),
});

const wanted = process.argv[2];
if (wanted) {
  const document = result.corpus.documents.find((doc) => doc.fileId === wanted);
  console.log(document ? renderDocument(document) : `unknown document ${wanted}`);
} else {
  let total = 0;
  for (const document of result.corpus.documents) {
    const tokens = estimateTokens(renderDocument(document));
    total += tokens;
    const entry = result.report.find((item) => item.fileId === document.fileId);
    console.log(
      `${document.fileId.padEnd(40)} ${document.format.padEnd(6)} blocks=${String(document.blocks.length).padStart(3)} tokens≈${String(tokens).padStart(6)} ${entry?.fromCache ? "cache" : `${entry?.ms}ms`}${document.ocr ? ` ocr=${document.ocr.confidence}` : ""}${document.warnings.length ? ` ⚠ ${document.warnings.join("; ")}` : ""}`,
    );
  }
  console.log(`total tokens≈${total}, ingestion ${result.totalMs} ms`);
}
