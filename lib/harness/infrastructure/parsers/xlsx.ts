import type { Block, CorpusDocument } from "../../domain/document";
import {
  attribute,
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

/**
 * Namespace-agnostic SpreadsheetML reader (fflate + XML). Handles prefixed
 * parts (e.g. `<x:workbook>` written by the OpenXML SDK, which exceljs cannot
 * read), shared/inline strings, cached formula results, date styles (1900 and
 * 1904 systems), hidden sheets and cell comments.
 */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormatCode(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(stripped) && !/^[#0.,%\s]+$/.test(stripped);
}

function dateStyleFlags(entries: ZipEntries): boolean[] {
  const xml = zipText(entries, "xl/styles.xml");
  if (!xml) return [];
  const tree = parseXml(xml);
  const custom = new Map<number, string>();
  for (const format of findAll(tree, "numFmt")) {
    custom.set(Number(attribute(format, "numFmtId")), attribute(format, "formatCode") ?? "");
  }
  const cellXfs = findFirst(tree, "cellXfs");
  return (cellXfs ? findAll(cellXfs.children, "xf") : []).map((xf) => {
    const id = Number(attribute(xf, "numFmtId") ?? 0);
    return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)!));
  });
}

function sharedStrings(entries: ZipEntries): string[] {
  const xml = zipText(entries, "xl/sharedStrings.xml");
  if (!xml) return [];
  // Direct <t> plus rich-text runs <r><t>; phonetic <rPh> hints are ignored.
  return findAll(parseXml(xml), "si").map((item) =>
    item.children
      .filter((child) => child.tag === "t" || child.tag === "r")
      .map((child) => collectText(child, "t"))
      .join(""),
  );
}

export function excelSerialToIso(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const millis = Math.round(serial * 86_400_000);
  const iso = new Date(epoch + millis).toISOString();
  return Number.isInteger(serial) || iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}

function columnIndex(reference: string | undefined, fallback: number): number {
  const letters = reference?.match(/^[A-Z]+/i)?.[0];
  if (!letters) return fallback;
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function cellText(cell: XmlNode, strings: string[], dateStyles: boolean[], date1904: boolean): string {
  const type = attribute(cell, "t");
  const valueNode = findFirst(cell.children, "v");
  const raw = valueNode ? collectText(valueNode, "v") : "";
  switch (type) {
    case "s":
      return (strings[Number(raw)] ?? "").trim();
    case "inlineStr": {
      const inline = findFirst(cell.children, "is");
      return inline ? collectText(inline, "t").trim() : "";
    }
    case "b":
      return raw === "1" ? "true" : raw === "0" ? "false" : raw;
    case "str":
    case "e":
      return raw.trim();
    case "d":
      return raw.slice(0, 10);
    default: {
      if (raw === "") {
        const formula = findFirst(cell.children, "f");
        return formula ? `=${collectText(formula, "f")}` : "";
      }
      const number = Number(raw);
      if (!Number.isFinite(number)) return raw.trim();
      const style = Number(attribute(cell, "s") ?? -1);
      if (style >= 0 && dateStyles[style]) return excelSerialToIso(number, date1904);
      return String(Number(number.toPrecision(15)));
    }
  }
}

function sheetComments(entries: ZipEntries, sheetPath: string): string[] {
  const relationships = readRelationships(entries, relsPathFor(sheetPath), partDir(sheetPath));
  const commentsPath = [...relationships.values()].find((target) => /comments\d*\.xml$/.test(target));
  const xml = commentsPath ? zipText(entries, commentsPath) : null;
  if (!xml) return [];
  return findAll(parseXml(xml), "comment")
    .map((comment) => `${attribute(comment, "ref") ?? "?"}: ${collectText(comment, "t").trim()}`)
    .filter((line) => !line.endsWith(": "));
}

export async function parseXlsx(fileId: string, bytes: Uint8Array): Promise<CorpusDocument> {
  const entries = unzip(bytes);
  const workbookXml = zipText(entries, "xl/workbook.xml");
  if (!workbookXml) return { fileId, format: "xlsx", title: fileId, blocks: [], warnings: ["xlsx: missing xl/workbook.xml"] };
  const workbook = parseXml(workbookXml);
  const workbookProperties = findFirst(workbook, "workbookPr");
  const date1904 = ["1", "true"].includes((workbookProperties && attribute(workbookProperties, "date1904")) ?? "");
  const relationships = readRelationships(entries, "xl/_rels/workbook.xml.rels", "xl");
  const strings = sharedStrings(entries);
  const dateStyles = dateStyleFlags(entries);
  const blocks: Block[] = [];
  const sheetNames: string[] = [];

  for (const sheet of findAll(workbook, "sheet")) {
    const name = attribute(sheet, "name") ?? "sheet";
    const target = relationships.get(relId(sheet) ?? "");
    const xml = target ? zipText(entries, target) : null;
    if (!target || !xml) continue;
    sheetNames.push(name);
    const state = attribute(sheet, "state");
    const locator = `sheet ${name}${state && state !== "visible" ? ` (${state})` : ""}`;

    const grid: string[][] = [];
    for (const row of findAll(parseXml(xml), "row")) {
      const cells: string[] = [];
      findAll(row.children, "c").forEach((cell, position) => {
        cells[columnIndex(attribute(cell, "r"), position)] = cellText(cell, strings, dateStyles, date1904);
      });
      grid.push(Array.from(cells, (cell) => cell ?? ""));
    }
    const width = Math.max(0, ...grid.map((row) => row.reduce((last, cell, i) => (cell ? i + 1 : last), 0)));
    const rows = grid.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? "")).filter((row) => row.some(Boolean));
    if (rows.length > 0) {
      const headerIndex = rows.findIndex((row) => row.filter(Boolean).length >= Math.max(Math.min(2, width), Math.ceil(width / 2)));
      const start = Math.max(0, headerIndex);
      if (start > 0) {
        blocks.push({ kind: "text", locator: `${locator} preface`, text: rows.slice(0, start).map((row) => row.filter(Boolean).join(" ")).join("\n") });
      }
      blocks.push({ kind: "table", locator, header: rows[start], rows: rows.slice(start + 1) });
    }
    const comments = sheetComments(entries, target);
    if (comments.length) blocks.push({ kind: "text", locator: `${locator} comments`, text: comments.join("\n") });
  }

  const warnings = blocks.length ? [] : ["xlsx: workbook has no populated cells"];
  return { fileId, format: "xlsx", title: `Workbook with sheets: ${sheetNames.join(", ")}`, blocks, warnings };
}
