/**
 * Deterministic query DSL over a parsed table (CSV, sheet, slide/PDF/Word
 * table). Used by the escalation agent so that row filtering and aggregation
 * are computed by code instead of by the model. Pure TypeScript: no SQL engine
 * (alasql needs runtime code generation, sql.js needs WASM — neither runs in
 * workerd).
 */
export interface TableLike {
  header: string[];
  rows: string[][];
}

export type FilterOp =
  | "eq" | "neq" | "contains" | "not_contains" | "starts_with"
  | "gt" | "gte" | "lt" | "lte" | "in" | "not_in";

export interface TableFilter {
  column: string;
  op: FilterOp;
  value: string | number | (string | number)[];
}

export type AggregateFn = "sum" | "count" | "min" | "max" | "avg" | "distinct" | "list";

export interface TableQuery {
  filters?: TableFilter[];
  aggregate?: { fn: AggregateFn; column?: string };
  groupBy?: string;
  columns?: string[];
  limit?: number;
}

export interface TableQueryResult {
  matchedRows: number;
  result?: number | string[] | Record<string, number | string[]>;
  rows?: Record<string, string>[];
}

export class TableQueryError extends Error {}

const normalizeName = (name: string) => name.trim().toLowerCase().replace(/[\s_-]+/g, " ");

export function parseNumeric(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = value.trim().replace(/^\((.*)\)$/, "-$1").replace(/[$€£,\s]/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function columnIndex(table: TableLike, column: string): number {
  const wanted = normalizeName(column);
  const index = table.header.findIndex((name) => normalizeName(name) === wanted);
  if (index === -1) {
    throw new TableQueryError(`unknown column "${column}"; available: ${table.header.join(", ")}`);
  }
  return index;
}

function compare(cell: string, op: FilterOp, expected: TableFilter["value"]): boolean {
  if (op === "in" || op === "not_in") {
    const options = (Array.isArray(expected) ? expected : [expected]).map((option) =>
      String(option).trim().toLowerCase(),
    );
    const hit = options.includes(cell.trim().toLowerCase());
    return op === "in" ? hit : !hit;
  }
  const scalar = Array.isArray(expected) ? expected[0] : expected;
  const left = parseNumeric(cell);
  const right = parseNumeric(scalar);
  const numeric = left !== null && right !== null;
  const a = cell.trim().toLowerCase();
  const b = String(scalar).trim().toLowerCase();
  switch (op) {
    case "eq":
      return numeric ? left === right : a === b;
    case "neq":
      return numeric ? left !== right : a !== b;
    case "contains":
      return a.includes(b);
    case "not_contains":
      return !a.includes(b);
    case "starts_with":
      return a.startsWith(b);
    case "gt":
      return numeric ? left > right : a > b;
    case "gte":
      return numeric ? left >= right : a >= b;
    case "lt":
      return numeric ? left < right : a < b;
    case "lte":
      return numeric ? left <= right : a <= b;
    default:
      throw new TableQueryError(`unknown operator "${String(op)}"`);
  }
}

function aggregate(rows: string[][], fn: AggregateFn, index: number | null): number | string[] {
  if (fn === "count") return rows.length;
  if (index === null) throw new TableQueryError(`aggregate "${fn}" needs a column`);
  const cells = rows.map((row) => row[index] ?? "");
  if (fn === "distinct") return [...new Set(cells)];
  if (fn === "list") return cells;
  const numbers = cells.map(parseNumeric).filter((value): value is number => value !== null);
  if (numbers.length === 0) throw new TableQueryError("no numeric values to aggregate");
  switch (fn) {
    case "sum":
      return numbers.reduce((total, value) => total + value, 0);
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
    case "avg":
      return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    default:
      throw new TableQueryError(`unknown aggregate "${String(fn)}"`);
  }
}

export function runTableQuery(table: TableLike, query: TableQuery): TableQueryResult {
  const filters = (query.filters ?? []).map((filter) => ({ ...filter, index: columnIndex(table, filter.column) }));
  const matched = table.rows.filter((row) =>
    filters.every((filter) => compare(row[filter.index] ?? "", filter.op, filter.value)),
  );

  if (query.aggregate) {
    const index = query.aggregate.column ? columnIndex(table, query.aggregate.column) : null;
    if (query.groupBy) {
      const groupIndex = columnIndex(table, query.groupBy);
      const groups = new Map<string, string[][]>();
      for (const row of matched) {
        const key = row[groupIndex] ?? "";
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const result: Record<string, number | string[]> = {};
      for (const [key, rows] of groups) result[key] = aggregate(rows, query.aggregate.fn, index);
      return { matchedRows: matched.length, result };
    }
    return { matchedRows: matched.length, result: aggregate(matched, query.aggregate.fn, index) };
  }

  const columns = query.columns?.map((column) => columnIndex(table, column));
  const limit = Math.min(query.limit ?? 50, 200);
  const rows = matched.slice(0, limit).map((row) => {
    const record: Record<string, string> = {};
    (columns ?? table.header.map((_, index) => index)).forEach((index) => {
      record[table.header[index]] = row[index] ?? "";
    });
    return record;
  });
  return { matchedRows: matched.length, rows };
}
