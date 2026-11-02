import type { Block, CorpusDocument } from "../../domain/document";
import type { OcrEngine } from "../ocr/types";
import { ocrMedia } from "./docx";
import {
  attribute,
  cleanText,
  collectText,
  findAll,
  findFirst,
  parseXml,
  partDir,
  readRelationships,
  relId,
  relsPathFor,
  unzip,
  zipText,
  type XmlNode,
  type ZipEntries,
} from "./xml";

// DrawingML / PresentationML local names (prefix-agnostic, see xml.ts).
const paragraphs = (node: XmlNode): string[] =>
  findAll([node], "p")
    .map((paragraph) => collectText(paragraph, "t", ["br"], [], ["pPr", "rPr", "endParaRPr"]).trim())
    .filter(Boolean);

function tableBlock(table: XmlNode, locator: string): Block | null {
  const rows = findAll(table.children, "tr")
    .map((row) => findAll(row.children, "tc").map((cell) => paragraphs(cell).join(" ")))
    .filter((row) => row.some(Boolean));
  if (rows.length === 0) return null;
  const [header, ...rest] = rows;
  return { kind: "table", locator, header, rows: rest };
}

/** Extracts cached category/series values from a chart part into a table. */
function chartBlock(entries: ZipEntries, chartPath: string, locator: string): Block | null {
  const xml = zipText(entries, chartPath);
  if (!xml) return null;
  const tree = parseXml(xml);
  const points = (node: XmlNode | undefined) => (node ? findAll([node], "pt").map((point) => collectText(point, "v").trim()) : []);
  const series = findAll(tree, "ser").map((ser) => ({
    name: (findFirst(ser.children, "tx") && collectText(findFirst(ser.children, "tx")!, "v").trim()) || "series",
    categories: points(findFirst(ser.children, "cat") ?? findFirst(ser.children, "xVal")),
    values: points(findFirst(ser.children, "val") ?? findFirst(ser.children, "yVal")),
  }));
  if (series.length === 0) return null;
  const categories = series.find((s) => s.categories.length)?.categories ?? series[0].values.map((_, i) => String(i + 1));
  const titleNode = findFirst(tree, "title");
  const title = titleNode ? cleanText(collectText(titleNode, "t")) : "";
  return {
    kind: "table",
    locator: `${locator}${title ? ` "${title}"` : ""}`,
    header: ["category", ...series.map((s) => s.name)],
    rows: categories.map((category, i) => [category, ...series.map((s) => s.values[i] ?? "")]),
  };
}

function slideOrder(entries: ZipEntries): string[] {
  const presentation = zipText(entries, "ppt/presentation.xml");
  const relationships = readRelationships(entries, "ppt/_rels/presentation.xml.rels", "ppt");
  const ordered = presentation
    ? findAll(parseXml(presentation), "sldId")
        .map((slide) => relationships.get(relId(slide) ?? ""))
        .filter((target): target is string => Boolean(target && entries[target]))
    : [];
  if (ordered.length) return ordered;
  return Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
}

const NON_CONTENT_PLACEHOLDERS = ["sldNum", "sldImg", "hdr", "ftr", "dt"];

function slideBlocks(entries: ZipEntries, slidePath: string, slideNumber: number): Block[] {
  const tree = parseXml(zipText(entries, slidePath) ?? "");
  const relationships = readRelationships(entries, relsPathFor(slidePath), partDir(slidePath));
  const blocks: Block[] = [];
  const texts: string[] = [];
  let tables = 0;
  let charts = 0;

  const visit = (nodes: XmlNode[]) => {
    for (const node of nodes) {
      if (node.tag === "sp") {
        texts.push(...paragraphs(node));
      } else if (node.tag === "graphicFrame") {
        const table = findFirst(node.children, "tbl");
        if (table) {
          const block = tableBlock(table, `slide ${slideNumber} table ${++tables}`);
          if (block) blocks.push(block);
          continue;
        }
        const chart = findFirst(node.children, "chart");
        const chartPath = chart && relationships.get(relId(chart) ?? "");
        if (chartPath) {
          const block = chartBlock(entries, chartPath, `slide ${slideNumber} chart ${++charts}`);
          if (block) blocks.push(block);
          continue;
        }
        // SmartArt: the text lives in the related diagram data part.
        const diagram = findFirst(node.children, "relIds");
        const dataPath = diagram && relationships.get(relId(diagram, "dm") ?? "");
        if (dataPath) texts.push(...findAll(parseXml(zipText(entries, dataPath) ?? ""), "p").flatMap(paragraphs));
      } else if (node.children.length) {
        visit(node.children);
      }
    }
  };
  visit(findAll(tree, "cSld"));
  const text = cleanText(texts.join("\n"));
  if (text) blocks.unshift({ kind: "text", locator: `slide ${slideNumber}`, text });

  const notesPath = [...relationships.values()].find((target) => target.includes("notesSlides/"));
  if (notesPath) {
    const notes = findAll(parseXml(zipText(entries, notesPath) ?? ""), "sp")
      .filter((shape) => !findAll(shape.children, "ph").some((ph) => NON_CONTENT_PLACEHOLDERS.includes(attribute(ph, "type") ?? "")))
      .flatMap(paragraphs);
    const notesText = cleanText(notes.join("\n"));
    if (notesText) blocks.push({ kind: "text", locator: `slide ${slideNumber} speaker notes`, text: notesText });
  }
  return blocks;
}

export async function parsePptx(fileId: string, bytes: Uint8Array, ocr?: OcrEngine): Promise<CorpusDocument> {
  const entries = unzip(bytes);
  const blocks = slideOrder(entries).flatMap((slidePath, index) => slideBlocks(entries, slidePath, index + 1));
  blocks.push(...(await ocrMedia(entries, "ppt/media/", ocr)));
  const first = blocks.find((block) => block.kind === "text");
  const title = first && first.kind === "text" ? first.text.split("\n").slice(0, 2).join(" — ") : fileId;
  return { fileId, format: "pptx", title, blocks, warnings: blocks.length ? [] : ["pptx: no slide content extracted"] };
}
