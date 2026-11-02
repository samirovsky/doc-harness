import assert from "node:assert/strict";
import { Then, When } from "@cucumber/cucumber";
import { canonicalize } from "@/lib/harness/domain/canonicalize";
import { costOfUsage } from "@/lib/harness/domain/cost";
import type { AnswerType } from "@/lib/harness/domain/contract";
import { createAgentToolbox } from "@/lib/harness/application/agent-tools";
import { priceCaps } from "./harness.steps";
import type { HarnessWorld } from "../support/world";

When(
  /^the raw value (.+) is canonicalized as an? (number|date|text|boolean) answer$/,
  function (this: HarnessWorld, raw: string, type: AnswerType) {
    this.canonical = canonicalize(JSON.parse(raw), type);
  },
);

Then(/^the canonical value is (.+)$/, function (this: HarnessWorld, raw: string) {
  assert.ok(this.canonical?.ok, `rejected: ${JSON.stringify(this.canonical)}`);
  assert.ok(Object.is(this.canonical.value, JSON.parse(raw)), `got ${JSON.stringify(this.canonical.value)}`);
});

Then("the value is rejected as non-canonical", function (this: HarnessWorld) {
  assert.equal(this.canonical?.ok, false, `accepted: ${JSON.stringify(this.canonical)}`);
});

When(
  "the agent tool {string} runs with:",
  function (this: HarnessWorld, tool: string, args: string) {
    assert.ok(this.corpus, "a data room must be arranged first");
    const toolbox = createAgentToolbox(this.corpus, new Set(this.corpus.documents.map((d) => d.fileId)));
    this.toolResult = toolbox.run(tool, args.trim());
  },
);

Then("the tool result contains {string}", function (this: HarnessWorld, text: string) {
  assert.ok(this.toolResult.toLowerCase().includes(text.toLowerCase()), this.toolResult);
});

Then("the first search hit is {string}", function (this: HarnessWorld, fileId: string) {
  const hits = JSON.parse(this.toolResult) as { hits: { fileId: string }[] };
  assert.equal(hits.hits[0]?.fileId, fileId, this.toolResult);
});

When(
  "a call reports {int} prompt tokens and {int} completion tokens without a cost",
  function (this: HarnessWorld, promptTokens: number, completionTokens: number) {
    this.callCost = costOfUsage({ promptTokens, completionTokens, costUsd: null }, priceCaps);
  },
);

Then("the estimated cost of that call is {float} USD", function (this: HarnessWorld, cost: number) {
  assert.ok(Math.abs(this.callCost - cost) < 1e-9, `${this.callCost}`);
});
