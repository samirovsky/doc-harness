import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textDocument } from "@/lib/harness/domain/document";
import { extractJsonObject } from "@/lib/harness/application/json";
import { createLimiter } from "@/lib/harness/application/metered-gateway";
import { groundEvidence, normalizeEvidence, reconcile } from "@/lib/harness/application/reconcile";
import type { Question } from "@/lib/harness/domain/contract";

const numberQuestion: Question = { questionId: "q_1", question: "How much?", answerType: "number", canonicalFormat: "raw number" };
const context = {
  fileIds: ["01_ledger.csv", "02_memo.pdf"],
  groundingDocuments: [textDocument("02_memo.pdf", "pdf", "Closing balance 4,321 credits; prior 43,210.")],
  escalationConfidence: 0.7,
};

describe("normalizeEvidence", () => {
  it("maps case, extension and decorated citations onto real file ids", () => {
    assert.deepEqual(normalizeEvidence(["01_LEDGER", "02_memo.pdf (page 2)", "nope.pdf", "01_ledger.csv"], context.fileIds), [
      "01_ledger.csv",
      "02_memo.pdf",
    ]);
    assert.deepEqual(normalizeEvidence("01_ledger.csv, 02_memo", context.fileIds), ["01_ledger.csv", "02_memo.pdf"]);
  });
});

describe("groundEvidence", () => {
  it("matches whole numbers only, never digits inside bigger numbers", () => {
    assert.deepEqual(groundEvidence(4321, context.groundingDocuments), ["02_memo.pdf"]);
    assert.deepEqual(groundEvidence(321, context.groundingDocuments), []);
    assert.deepEqual(groundEvidence(true, context.groundingDocuments), []);
  });
});

describe("reconcile", () => {
  it("recovers a number from calc when the stated value is not canonical", () => {
    const candidate = reconcile(numberQuestion, { questionId: "q_1", value: "about 300k", calc: "280000 + 20000", evidenceFileIds: ["01_ledger.csv"], confidence: 0.9 }, context);
    assert.equal(candidate.value, 300000);
    assert.ok(!candidate.flags.includes("invalid_value"));
  });
  it("drops evidence for null answers and flags low confidence", () => {
    const candidate = reconcile(numberQuestion, { questionId: "q_1", value: null, evidenceFileIds: ["01_ledger.csv"], confidence: 0.4 }, context);
    assert.deepEqual(candidate.evidenceFileIds, []);
    assert.ok(candidate.flags.includes("low_confidence"));
  });
  it("accepts percentage-style confidences", () => {
    const candidate = reconcile(numberQuestion, { questionId: "q_1", value: 1, evidenceFileIds: ["01_ledger.csv"], confidence: 90 }, context);
    assert.equal(candidate.confidence, 0.9);
  });
});

describe("extractJsonObject", () => {
  it("handles fences, preambles and trailing commas", () => {
    assert.deepEqual(extractJsonObject('Sure!\n```json\n{"a": [1, 2,],}\n```'), { a: [1, 2] });
    assert.throws(() => extractJsonObject("no json here"));
  });
});

describe("createLimiter", () => {
  it("never runs more than N tasks at once", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );
    assert.equal(peak, 2);
  });
});

describe("estimateAbandoned", () => {
  it("prices an abandoned hedge at the rate the provider charged the winner", async () => {
    const { estimateAbandoned } = await import("@/lib/harness/application/hedging-gateway");
    const winner = { content: "", toolCalls: [], usage: { promptTokens: 1000, completionTokens: 100, costUsd: 0.0013 } };
    const estimate = estimateAbandoned(winner, { purpose: "answer", messages: [] }, Date.now(), {});
    assert.equal(estimate.promptTokens, 1000);
    assert.equal(estimate.completionTokens, 100);
    assert.ok(Math.abs((estimate.costUsd ?? 0) - 0.0013) < 1e-12);
    const unpriced = estimateAbandoned({ ...winner, usage: { ...winner.usage, costUsd: null } }, { purpose: "answer", messages: [] }, Date.now(), {});
    assert.equal(unpriced.costUsd, null);
  });
});
