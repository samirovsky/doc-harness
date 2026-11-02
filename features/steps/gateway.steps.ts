import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { openRouterRequestDefaults } from "@/lib/challenge/openrouter";
import type { LlmResponse } from "@/lib/harness/application/ports";
import { OpenRouterGateway } from "@/lib/harness/infrastructure/llm/openrouter-gateway";
import type { HarnessWorld } from "../support/world";

interface GatewayWorld extends HarnessWorld {
  body?: Record<string, unknown>;
  attempts?: number;
  fetchImpl?: typeof fetch;
  response?: LlmResponse;
}

When(
  "the OpenRouter adapter builds a request that asks for JSON, tools and high reasoning",
  function (this: GatewayWorld) {
    const gateway = new OpenRouterGateway({ apiKey: "test", defaults: openRouterRequestDefaults });
    this.body = gateway.buildBody({
      purpose: "agent",
      json: true,
      reasoning: "high",
      tools: [{ name: "calculate", description: "math", parameters: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }],
    });
  },
);

Then(
  "the request uses the model and provider policy from lib\\/challenge\\/openrouter.ts unchanged",
  function (this: GatewayWorld) {
    assert.equal(this.body!.model, openRouterRequestDefaults.model);
    assert.deepEqual(this.body!.provider, openRouterRequestDefaults.provider);
  },
);

Then("the request asks OpenRouter to include usage cost", function (this: GatewayWorld) {
  assert.deepEqual(this.body!.usage, { include: true });
});

Given(
  "an OpenRouter endpoint that fails once with status {int} and then answers with cost {float}",
  function (this: GatewayWorld, status: number, cost: number) {
    this.attempts = 0;
    this.fetchImpl = (async () => {
      this.attempts! += 1;
      if (this.attempts === 1) return new Response("upstream busy", { status });
      return Response.json({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, cost },
      });
    }) as typeof fetch;
  },
);

When("the adapter completes a request", async function (this: GatewayWorld) {
  const gateway = new OpenRouterGateway({
    apiKey: "test",
    defaults: openRouterRequestDefaults,
    fetchImpl: this.fetchImpl,
  });
  this.response = await gateway.complete({ purpose: "answer", messages: [{ role: "user", content: "hi" }] });
});

Then("the adapter made {int} HTTP attempts", function (this: GatewayWorld, attempts: number) {
  assert.equal(this.attempts, attempts);
});

Then("the reported usage cost is {float} USD", function (this: GatewayWorld, cost: number) {
  assert.equal(this.response!.usage.costUsd, cost);
});
