import { ArithmeticError, evaluateArithmetic } from "../domain/arithmetic";
import { Bm25Index, chunkDocuments } from "../domain/bm25";
import { cleanNumber } from "../domain/canonicalize";
import { renderDocument, type Corpus, type TableBlock } from "../domain/document";
import { runTableQuery, TableQueryError, type TableQuery } from "../domain/table-query";
import type { ToolSpec } from "./ports";

export interface AgentToolbox {
  specs: ToolSpec[];
  /** Runs a tool and returns its JSON result as text (errors are returned, not thrown). */
  run(name: string, rawArguments: string): string;
}

const FINAL_ANSWER_SPEC: ToolSpec = {
  name: "final_answer",
  description: "Submit the final answer. Call exactly once, after verifying the evidence.",
  parameters: {
    type: "object",
    properties: {
      value: { description: "number | string | boolean | null, canonical per the question's answerType" },
      calc: { type: ["string", "null"], description: "arithmetic expression that produced a derived number, else null" },
      evidenceFileIds: { type: "array", items: { type: "string" }, description: "decisive document ids; empty only if value is null" },
      confidence: { type: "number", description: "0..1" },
      rationale: { type: "string", description: "<= 25 words" },
    },
    required: ["value", "evidenceFileIds", "confidence", "rationale"],
  },
};

const SPECS: ToolSpec[] = [
  {
    name: "search_corpus",
    description: "Lexical (BM25) search across all documents. Returns ranked snippets with fileId, locator and triage role.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        fileId: { type: "string", description: "optional: restrict to one document" },
        limit: { type: "integer", description: "default 6, max 12" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_document",
    description: "Read a document's full normalized text, or only the blocks whose locator contains `locator` (e.g. 'page 2', 'sheet Assets', 'slide 4').",
    parameters: {
      type: "object",
      properties: { fileId: { type: "string" }, locator: { type: "string" } },
      required: ["fileId"],
    },
  },
  {
    name: "query_table",
    description:
      "Filter and aggregate rows of a table deterministically. Filters: {column, op: eq|neq|contains|not_contains|starts_with|gt|gte|lt|lte|in|not_in, value}. Aggregate fn: sum|count|min|max|avg|distinct|list. Without aggregate, returns matching rows.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        table: { type: "string", description: "table locator (needed when the document has several tables)" },
        filters: { type: "array", items: { type: "object" } },
        aggregate: { type: "object", properties: { fn: { type: "string" }, column: { type: "string" } } },
        groupBy: { type: "string" },
        columns: { type: "array", items: { type: "string" } },
        limit: { type: "integer" },
      },
      required: ["fileId"],
    },
  },
  {
    name: "calculate",
    description: "Exact arithmetic with + - * / and parentheses, e.g. '(120000 + 85000) - 45000'.",
    parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  },
  FINAL_ANSWER_SPEC,
];

const MAX_READ_CHARS = 14_000;

export function createAgentToolbox(corpus: Corpus, roles: Map<string, string> | Set<string>): AgentToolbox {
  const roleOf = (fileId: string) => (roles instanceof Map ? roles.get(fileId) ?? "core" : "core");
  let index: Bm25Index | null = null;
  const searchIndex = () => (index ??= new Bm25Index(chunkDocuments(corpus.documents, 300)));
  const documentById = (fileId: string) =>
    corpus.documents.find((document) => document.fileId === fileId) ??
    corpus.documents.find((document) => document.fileId.toLowerCase() === String(fileId).toLowerCase());

  const tools: Record<string, (args: Record<string, unknown>) => unknown> = {
    search_corpus(args) {
      const limit = Math.min(12, Math.max(1, Number(args.limit ?? 6)));
      const fileId = args.fileId ? String(args.fileId) : null;
      const hits = searchIndex().search(String(args.query ?? ""), limit, fileId ? (chunk) => chunk.fileId === fileId : undefined);
      return {
        hits: hits.map((hit) => ({
          fileId: hit.chunk.fileId,
          role: roleOf(hit.chunk.fileId),
          locator: hit.chunk.locator,
          score: Math.round(hit.score * 100) / 100,
          snippet: hit.chunk.text.slice(0, 700),
        })),
      };
    },
    read_document(args) {
      const document = documentById(String(args.fileId ?? ""));
      if (!document) return { error: `unknown fileId; known: ${corpus.documents.map((d) => d.fileId).join(", ")}` };
      const locator = args.locator ? String(args.locator).toLowerCase() : null;
      const blocks = locator ? document.blocks.filter((block) => block.locator.toLowerCase().includes(locator)) : document.blocks;
      if (blocks.length === 0) return { error: `no block matches "${args.locator}"; locators: ${document.blocks.map((b) => b.locator).join(", ")}` };
      const text = renderDocument(document, blocks);
      return { role: roleOf(document.fileId), text: text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n…[truncated; read by locator]` : text };
    },
    query_table(args) {
      const document = documentById(String(args.fileId ?? ""));
      if (!document) return { error: "unknown fileId" };
      const tables = document.blocks.filter((block): block is TableBlock => block.kind === "table");
      const wanted = args.table ? String(args.table).toLowerCase() : null;
      const table = wanted
        ? tables.find((block) => block.locator.toLowerCase() === wanted) ?? tables.find((block) => block.locator.toLowerCase().includes(wanted))
        : tables.length === 1
          ? tables[0]
          : undefined;
      if (!table) {
        return { error: "specify `table`", tables: tables.map((block) => ({ table: block.locator, columns: block.header, rows: block.rows.length })) };
      }
      const result = runTableQuery(table, args as TableQuery);
      return { table: table.locator, ...result };
    },
    calculate(args) {
      const value = evaluateArithmetic(String(args.expression ?? ""));
      return { result: cleanNumber(value) };
    },
  };

  return {
    specs: SPECS,
    run(name, rawArguments) {
      const tool = tools[name];
      if (!tool) return JSON.stringify({ error: `unknown tool ${name}` });
      try {
        const args = rawArguments.trim() ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
        return JSON.stringify(tool(args));
      } catch (error) {
        const known = error instanceof ArithmeticError || error instanceof TableQueryError || error instanceof SyntaxError;
        return JSON.stringify({ error: known ? (error as Error).message : `tool failed: ${(error as Error).message}` });
      }
    },
  };
}
