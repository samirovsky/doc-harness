import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArithmeticError, evaluateArithmetic } from "@/lib/harness/domain/arithmetic";
import { Bm25Index, chunkDocuments, tokenize } from "@/lib/harness/domain/bm25";
import { canonicalize, cleanNumber } from "@/lib/harness/domain/canonicalize";
import { CostLedger } from "@/lib/harness/domain/cost";
import { textDocument } from "@/lib/harness/domain/document";
import { validateCaseOutput } from "@/lib/harness/domain/output";
import { runTableQuery, TableQueryError } from "@/lib/harness/domain/table-query";

describe("canonicalize", () => {
  it("rejects strings holding several numbers instead of guessing", () => {
    assert.equal(canonicalize("Q3 2025: 1,320,000", "number").ok, false);
    assert.equal(canonicalize("2025-09-18", "number").ok, false);
  });
  it("rejects comparative phrasing", () => {
    assert.equal(canonicalize("more than 20", "number").ok, false);
  });
  it("keeps integers exact and strips float noise", () => {
    assert.equal(cleanNumber(0.1 + 0.2), 0.3);
    assert.equal(cleanNumber(-0), 0);
    assert.ok(Object.is(cleanNumber(-0), 0));
    assert.equal(cleanNumber(1234567890123), 1234567890123);
  });
  it("handles multipliers and unicode minus", () => {
    assert.deepEqual(canonicalize("1.5 million", "number"), { ok: true, value: 1500000 });
    assert.deepEqual(canonicalize("−45,000", "number"), { ok: true, value: -45000 });
  });
  it("rejects impossible calendar dates and ambiguous day/month", () => {
    assert.equal(canonicalize("2025-02-29", "date").ok, false);
    assert.deepEqual(canonicalize("2024-02-29", "date"), { ok: true, value: "2024-02-29" });
    assert.equal(canonicalize("03/04/2025", "date").ok, false);
    assert.deepEqual(canonicalize("25/04/2025", "date"), { ok: true, value: "2025-04-25" });
  });
  it("treats empty text as null and keeps inner punctuation", () => {
    assert.deepEqual(canonicalize("  ", "text"), { ok: true, value: null });
    assert.deepEqual(canonicalize("B-109.", "text"), { ok: true, value: "b-109" });
  });
});

describe("evaluateArithmetic", () => {
  it("respects precedence, parentheses and thousands separators", () => {
    assert.equal(evaluateArithmetic("1,320,000 - 1,056,000"), 264000);
    assert.equal(evaluateArithmetic("2 * (3 + 4) / 7"), 2);
    assert.equal(evaluateArithmetic("-(5 - 8)"), 3);
  });
  it("refuses identifiers, calls and division by zero", () => {
    assert.throws(() => evaluateArithmetic("constructor"), ArithmeticError);
    assert.throws(() => evaluateArithmetic("Math.max(1,2)"), ArithmeticError);
    assert.throws(() => evaluateArithmetic("1/0"), ArithmeticError);
    assert.throws(() => evaluateArithmetic("1 +"), ArithmeticError);
  });
});

describe("runTableQuery", () => {
  const table = {
    header: ["id", "amount", "status", "date"],
    rows: [
      ["A", "1,000", "completed", "2025-09-03"],
      ["B", "250", "reversed", "2025-09-11"],
      ["C", "(50)", "completed", "2025-10-02"],
    ],
  };
  it("filters numerically, by ISO date range and by set membership", () => {
    assert.equal(runTableQuery(table, { filters: [{ column: "Amount", op: "gt", value: 300 }] }).matchedRows, 1);
    assert.deepEqual(
      runTableQuery(table, {
        filters: [{ column: "date", op: "lt", value: "2025-10-01" }],
        aggregate: { fn: "sum", column: "amount" },
      }).result,
      1250,
    );
    assert.equal(
      runTableQuery(table, { filters: [{ column: "status", op: "in", value: ["reversed", "void"] }] }).matchedRows,
      1,
    );
  });
  it("groups and reports parenthesized negatives", () => {
    assert.deepEqual(
      runTableQuery(table, { groupBy: "status", aggregate: { fn: "sum", column: "amount" } }).result,
      { completed: 950, reversed: 250 },
    );
  });
  it("explains unknown columns", () => {
    assert.throws(() => runTableQuery(table, { filters: [{ column: "nope", op: "eq", value: 1 }] }), TableQueryError);
  });
});

describe("bm25", () => {
  it("indexes identifiers both whole and by parts", () => {
    assert.ok(tokenize("Badge B-109 revoked").includes("b-109"));
    assert.ok(tokenize("Badge B-109 revoked").includes("109"));
    assert.ok(tokenize("total 1,320,000").includes("1320000"));
  });
  it("ranks the chunk sharing rare terms first and respects chunk budgets", () => {
    const documents = [
      textDocument("a.pdf", "pdf", "General operations narrative.\n".repeat(40)),
      textDocument("b.pdf", "pdf", "Insurance deductible amended to 75,000 effective September."),
    ];
    const chunks = chunkDocuments(documents, 60);
    assert.ok(chunks.every((chunk) => chunk.tokens <= 80));
    const hits = new Bm25Index(chunks).search("current insurance deductible", 3);
    assert.equal(hits[0].chunk.fileId, "b.pdf");
  });
});

describe("validateCaseOutput", () => {
  it("accepts a schema-shaped payload and rejects contract violations", () => {
    const valid = { caseId: "c", estimatedCostUsd: 0.01, answers: { q_1: { value: 1, evidenceFileIds: ["a"] } } };
    assert.deepEqual(validateCaseOutput(valid), []);
    assert.ok(validateCaseOutput({ ...valid, extra: 1 }).length > 0);
    assert.ok(validateCaseOutput({ ...valid, answers: { q_1: { value: 1, evidenceFileIds: [] } } }).length > 0);
    assert.ok(validateCaseOutput({ ...valid, answers: { q_1: { value: NaN, evidenceFileIds: ["a"] } } }).length > 0);
  });
});

describe("CostLedger", () => {
  it("prefers provider cost and falls back to the price caps", () => {
    const ledger = new CostLedger({ promptPerMillion: 0.2, completionPerMillion: 0.6 });
    ledger.record("answer", { promptTokens: 10, completionTokens: 10, costUsd: 0.5 });
    ledger.record("answer", { promptTokens: 1_000_000, completionTokens: 0, costUsd: null });
    assert.equal(ledger.totalUsd, 0.7);
    assert.equal(ledger.entries[1].estimated, true);
  });
});
