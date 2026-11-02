import Papa from "papaparse";
import type { CorpusDocument } from "../../domain/document";

/** CSV/TSV → one table block (first row is the header). */
export function parseCsvText(fileId: string, text: string): CorpusDocument {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), {
    skipEmptyLines: "greedy",
    delimiter: fileId.toLowerCase().endsWith(".tsv") ? "\t" : "",
  });
  const rows = parsed.data.map((row) => row.map((cell) => String(cell ?? "").trim()));
  const [header = [], ...body] = rows;
  const warnings = parsed.errors.slice(0, 5).map((error) => `csv: ${error.message} (row ${error.row})`);
  return {
    fileId,
    format: "csv",
    title: fileId,
    blocks: [{ kind: "table", locator: "rows", header, rows: body }],
    warnings,
  };
}
