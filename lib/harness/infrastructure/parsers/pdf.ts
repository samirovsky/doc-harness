import { getDocumentProxy } from "unpdf";
import type { Block, CorpusDocument } from "../../domain/document";
import { cleanText } from "./xml";

interface Run {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rebuilds reading lines from positioned text runs: runs are grouped into
 * lines by baseline, ordered by x, and separated by " | " when the horizontal
 * gap indicates a new table column. This keeps every table row on one line.
 */
function layoutLines(runs: Run[]): string[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Run[][] = [];
  for (const run of sorted) {
    const line = lines.at(-1);
    const tolerance = Math.max(2, 0.45 * Math.max(run.height, line?.[0].height ?? 0));
    if (line && Math.abs(line[0].y - run.y) <= tolerance) line.push(run);
    else lines.push([run]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    let output = "";
    let previousEnd: number | null = null;
    for (const run of line) {
      if (previousEnd !== null) {
        const gap = run.x - previousEnd;
        const columnGap = Math.max(6, 1.2 * run.height);
        output += gap > columnGap ? " | " : gap > 0.12 * run.height && !output.endsWith(" ") ? " " : "";
      }
      output += run.text;
      previousEnd = run.x + run.width;
    }
    return output.trim();
  });
}

export async function parsePdf(fileId: string, bytes: Uint8Array): Promise<CorpusDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const blocks: Block[] = [];
  const warnings: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const runs: Run[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      runs.push({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: Math.abs(item.height) || Math.abs(item.transform[3]) || 8,
      });
    }
    const text = cleanText(layoutLines(runs).join("\n"));
    if (text) blocks.push({ kind: "text", locator: `page ${pageNumber}`, text });
  }
  if (blocks.length === 0) warnings.push("pdf: no extractable text layer (scanned PDF OCR not implemented)");
  const title = blocks[0]?.kind === "text" ? blocks[0].text.split("\n").slice(0, 2).join(" — ") : fileId;
  await (pdf as unknown as { cleanup?: () => Promise<void> }).cleanup?.();
  return { fileId, format: "pdf", title, blocks, warnings };
}
