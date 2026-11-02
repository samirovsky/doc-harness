import type { Block, CorpusDocument } from "../../domain/document";
import type { OcrEngine } from "../ocr/types";
import { imageMimeType } from "./image";
import { cleanText, collectText, findAll, parseXml, unzip, zipText, type XmlNode, type ZipEntries } from "./xml";

// WordprocessingML local names (prefix-agnostic, see xml.ts).
const BREAKS = ["br", "cr"];
const TABS = ["tab"];
const SKIP = ["pPr", "rPr", "instrText", "delText"];

function paragraphText(node: XmlNode): string {
  return collectText(node, "t", BREAKS, TABS, SKIP).trim();
}

function tableRows(table: XmlNode): string[][] {
  return findAll(table.children, "tr").map((row) =>
    findAll(row.children, "tc").map((cell) => findAll(cell.children, "p").map(paragraphText).filter(Boolean).join(" ").trim()),
  );
}

/** Walks the body in document order so tables stay between the paragraphs around them. */
function bodyBlocks(body: XmlNode[]): Block[] {
  const blocks: Block[] = [];
  let paragraphs: string[] = [];
  let textIndex = 0;
  let tableIndex = 0;
  const flush = () => {
    const text = cleanText(paragraphs.join("\n"));
    if (text) blocks.push({ kind: "text", locator: `text ${++textIndex}`, text });
    paragraphs = [];
  };
  const visit = (nodes: XmlNode[]) => {
    for (const node of nodes) {
      if (node.tag === "p") {
        const text = paragraphText(node);
        if (text) paragraphs.push(text);
      } else if (node.tag === "tbl") {
        flush();
        const rows = tableRows(node).filter((row) => row.some(Boolean));
        if (rows.length > 0) {
          const [header, ...rest] = rows;
          blocks.push({ kind: "table", locator: `table ${++tableIndex}`, header, rows: rest });
        }
      } else if (["sdt", "sdtContent", "customXml", "smartTag", "ins"].includes(node.tag)) {
        visit(node.children);
      }
    }
  };
  visit(body);
  flush();
  return blocks;
}

function partTexts(entries: ZipEntries, prefix: string): string[] {
  return Object.keys(entries)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".xml"))
    .sort()
    .map((name) => cleanText(findAll(parseXml(zipText(entries, name) ?? ""), "p").map(paragraphText).filter(Boolean).join("\n")))
    .filter(Boolean);
}

/** OCRs images embedded in an OOXML package (charts/screenshots pasted into decks or memos). */
export async function ocrMedia(entries: ZipEntries, prefix: string, ocr: OcrEngine | undefined): Promise<Block[]> {
  if (!ocr) return [];
  const blocks: Block[] = [];
  for (const name of Object.keys(entries).sort()) {
    if (!name.startsWith(prefix) || !imageMimeType(name) || entries[name].byteLength < 8_000) continue;
    const result = await ocr.recognize(entries[name]);
    const text = cleanText(result.text);
    if (text.replace(/\W/g, "").length >= 10) {
      blocks.push({ kind: "text", locator: `embedded image ${name.split("/").pop()} (OCR ${Math.round(result.confidence)})`, text });
    }
  }
  return blocks;
}

export async function parseDocx(fileId: string, bytes: Uint8Array, ocr?: OcrEngine): Promise<CorpusDocument> {
  const entries = unzip(bytes);
  const documentXml = zipText(entries, "word/document.xml");
  if (!documentXml) return { fileId, format: "docx", title: fileId, blocks: [], warnings: ["docx: missing word/document.xml"] };
  const body = findAll(parseXml(documentXml), "body")[0]?.children ?? [];
  const blocks = bodyBlocks(body);

  for (const [prefix, label] of [
    ["word/header", "page header"],
    ["word/footer", "page footer"],
    ["word/footnotes", "footnotes"],
    ["word/endnotes", "endnotes"],
    ["word/comments", "reviewer comments"],
  ] as const) {
    const texts = partTexts(entries, prefix);
    if (texts.length) blocks.push({ kind: "text", locator: label, text: [...new Set(texts)].join("\n") });
  }
  blocks.push(...(await ocrMedia(entries, "word/media/", ocr)));

  const first = blocks.find((block) => block.kind === "text");
  const title = first && first.kind === "text" ? first.text.split("\n").slice(0, 2).join(" — ") : fileId;
  return { fileId, format: "docx", title, blocks, warnings: blocks.length ? [] : ["docx: no text extracted"] };
}
