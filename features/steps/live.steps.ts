import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { OpenRouterGateway } from "@/lib/harness/infrastructure/llm/openrouter-gateway";
import { scoreAgainstKey } from "@/lib/harness/evaluation/score";
import { openRouterRequestDefaults } from "@/lib/challenge/openrouter";
import { answer, assertSchemaValid } from "./harness.steps";
import { practiceKey, practicePlaybook } from "../support/practice";
import type { HarnessWorld } from "../support/world";

Given("the live OpenRouter model", function (this: HarnessWorld) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return "skipped";
  this.liveGateway = new OpenRouterGateway({ apiKey, defaults: openRouterRequestDefaults });
});

When("the harness answers the practice playbook", async function (this: HarnessWorld) {
  this.playbook = await practicePlaybook();
  await answer(this, this.playbook);
});

Then(
  "at least {int} of {int} answers match the practice key by value and source",
  async function (this: HarnessWorld, minimum: number, total: number) {
    const score = scoreAgainstKey(this.output!, await practiceKey(), this.playbook!.questions);
    const misses = score.rows.filter((row) => !row.correct);
    this.attach(JSON.stringify(misses, null, 2), "application/json");
    assert.equal(score.total, total);
    assert.ok(score.correct >= minimum, `${score.correct}/${total}; misses: ${JSON.stringify(misses)}`);
  },
);

Then("the estimated cost is below {float} USD", function (this: HarnessWorld, maximum: number) {
  assert.ok(this.output!.estimatedCostUsd < maximum, `${this.output!.estimatedCostUsd}`);
});

Then("the run took less than {int} seconds", function (this: HarnessWorld, seconds: number) {
  assert.ok(this.durationMs < seconds * 1000, `${this.durationMs} ms`);
});

export { assertSchemaValid };
