import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Given, Then, When, type DataTable } from "@cucumber/cucumber";
import Ajv2020 from "ajv/dist/2020.js";
import { runCase } from "@/lib/harness/application/run-case";
import { textDocument, type CorpusDocument } from "@/lib/harness/domain/document";
import { estimateTokens } from "@/lib/harness/domain/tokens";
import { parseCsvText } from "@/lib/harness/infrastructure/parsers/csv";
import { openRouterRequestDefaults } from "@/lib/challenge/openrouter";
import type { AnswerType, CaseInput } from "@/lib/harness/domain/contract";
import { promptText } from "../support/fake-model";
import { repoRoot } from "../support/practice";
import type { HarnessWorld } from "../support/world";

const VALUE = String.raw`(null|true|false|-?[\d.]+|"(?:[^"\\]|\\.)*")`;

function parseValue(raw: string): unknown {
  return JSON.parse(raw);
}

function splitIds(raw: string): string[] {
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function buildDocument(fileId: string, content: string): CorpusDocument {
  return fileId.toLowerCase().endsWith(".csv")
    ? parseCsvText(fileId, content)
    : textDocument(fileId, fileId.split(".").pop() ?? "text", content);
}

export const priceCaps = {
  promptPerMillion: openRouterRequestDefaults.provider.max_price.prompt,
  completionPerMillion: openRouterRequestDefaults.provider.max_price.completion,
};

// ---------------------------------------------------------------- arrange

Given("a data room with documents:", function (this: HarnessWorld, table: DataTable) {
  this.corpus = {
    documents: table.hashes().map(({ fileId, content }) => buildDocument(fileId, content)),
  };
});

Given(
  "a data room of {int} filler documents and one document {string} containing {string}",
  function (this: HarnessWorld, count: number, fileId: string, content: string) {
    const filler: CorpusDocument[] = Array.from({ length: count }, (_, index) =>
      textDocument(
        `filler_${String(index).padStart(2, "0")}.pdf`,
        "pdf",
        `Routine archive memo ${index}. ` +
          "Operations continued without notable change across the period. ".repeat(12),
      ),
    );
    this.corpus = { documents: [...filler, buildDocument(fileId, content)] };
  },
);

Given("a playbook with questions:", function (this: HarnessWorld, table: DataTable) {
  this.playbook = {
    caseId: "test-case",
    questions: table.hashes().map(({ questionId, answerType, question }) => ({
      questionId,
      question,
      answerType: answerType as AnswerType,
      canonicalFormat: "canonical",
    })),
  };
});

Given("a playbook of {int} number questions", function (this: HarnessWorld, count: number) {
  this.playbook = {
    caseId: "test-case",
    questions: Array.from({ length: count }, (_, index) => ({
      questionId: `q_${String(index + 1).padStart(3, "0")}`,
      question: `What is metric number ${index + 1}?`,
      answerType: "number" as const,
      canonicalFormat: "raw number without units or separators",
    })),
  };
});

Given("a model that answers every question with a plausible value", function (this: HarnessWorld) {
  // The scripted model answers unscripted questions with plausible typed values by default.
  this.fake.failAll = false;
});

Given(
  new RegExp(
    String.raw`^a model that answers "([^"]+)" with ${VALUE}(?: using calc "([^"]*)")?(?: with confidence ([\d.]+))? citing "([^"]*)"$`,
  ),
  function (
    this: HarnessWorld,
    questionId: string,
    rawValue: string,
    calc: string | undefined,
    confidence: string | undefined,
    evidence: string,
  ) {
    this.fake.answers.set(questionId, {
      value: parseValue(rawValue),
      calc: calc || undefined,
      // Cucumber passes "" (not undefined) for optional groups that did not match.
      confidence: confidence ? Number(confidence) : undefined,
      evidence: splitIds(evidence),
    });
  },
);

Given(
  new RegExp(
    String.raw`^a model that answers "([^"]+)" with ${VALUE} in the first pass and ${VALUE} in the second pass citing "([^"]*)"$`,
  ),
  function (this: HarnessWorld, questionId: string, first: string, second: string, evidence: string) {
    this.fake.answers.set(questionId, { value: parseValue(first), evidence: splitIds(evidence) });
    this.fake.secondPassAnswers.set(questionId, { value: parseValue(second), evidence: splitIds(evidence) });
  },
);

Given(
  new RegExp(
    String.raw`^a model that answers "([^"]+)" with ${VALUE} using calc "([^"]*)" in the first pass and ${VALUE} in the second pass citing "([^"]*)"$`,
  ),
  function (this: HarnessWorld, questionId: string, first: string, calc: string, second: string, evidence: string) {
    this.fake.answers.set(questionId, { value: parseValue(first), calc, evidence: splitIds(evidence) });
    this.fake.secondPassAnswers.set(questionId, { value: parseValue(second), evidence: splitIds(evidence) });
  },
);

Then("the question {string} was not adjudicated", function (this: HarnessWorld, questionId: string) {
  assert.ok(!this.trace!.adjudicated.includes(questionId), `adjudicated: ${this.trace!.adjudicated}`);
});

Given("a model whose second-pass calls take {int} ms", function (this: HarnessWorld, ms: number) {
  this.fake.secondPassDelayMs = ms;
});

Given("a second-pass grace period of {int} ms", function (this: HarnessWorld, ms: number) {
  this.config.consistencyGraceMs = ms;
});

Given("a single answer pass", function (this: HarnessWorld) {
  this.config.consistency = false;
});

Given("a model whose calls always fail", function (this: HarnessWorld) {
  this.fake.failAll = true;
});

Given("a model whose triage calls fail", function (this: HarnessWorld) {
  this.fake.failTriage = true;
});

Given("a model that triages {string} as archive", function (this: HarnessWorld, fileId: string) {
  this.fake.triageRoles.set(fileId, "archive");
});

Given("a model that reports a cost of {float} USD per call", function (this: HarnessWorld, cost: number) {
  this.fake.costPerCall = cost;
});

Given(
  new RegExp(String.raw`^an agent that answers "([^"]+)" with ${VALUE} citing "([^"]*)"$`),
  function (this: HarnessWorld, questionId: string, rawValue: string, evidence: string) {
    this.fake.agentBehaviors.set(questionId, {
      kind: "answer",
      value: parseValue(rawValue),
      evidence: splitIds(evidence),
    });
  },
);

Given(
  new RegExp(String.raw`^an adjudicator that answers "([^"]+)" with ${VALUE} citing "([^"]*)"$`),
  function (this: HarnessWorld, questionId: string, rawValue: string, evidence: string) {
    this.fake.adjudications.set(questionId, { value: parseValue(rawValue), evidence: splitIds(evidence) });
  },
);

Given("an adjudicator that always fails", function (this: HarnessWorld) {
  this.fake.adjudications.clear();
});

Given("an agent that always fails", function (this: HarnessWorld) {
  this.fake.defaultAgent = { kind: "fail" };
});

Given("an agent that keeps calling tools forever", function (this: HarnessWorld) {
  this.fake.defaultAgent = { kind: "loop" };
});

Given("an agent step limit of {int}", function (this: HarnessWorld, steps: number) {
  this.config.agentMaxSteps = steps;
});

Given(
  "a model whose first answer call takes {int} ms and later calls take {int} ms",
  function (this: HarnessWorld, first: number, later: number) {
    this.fake.answerDelaysMs = [first, later];
  },
);

Given(
  "a model whose answer calls take {int} ms, {int} ms, then {int} ms",
  function (this: HarnessWorld, first: number, second: number, later: number) {
    this.fake.answerDelaysMs = [first, second, later];
  },
);

Given(
  "answer calls are hedged after {int} ms with reasoning {string}",
  function (this: HarnessWorld, afterMs: number, reasoning: "off" | "low" | "medium" | "high") {
    this.config.hedgeAfterMs = afterMs;
    this.config.hedgeReasoning = reasoning;
  },
);

Then("the first answer call used reasoning {string}", function (this: HarnessWorld, reasoning: string) {
  assert.equal(this.fake.requestsFor("answer")[0].reasoning, reasoning);
});

Then("the hedge answer call used reasoning {string}", function (this: HarnessWorld, reasoning: string) {
  assert.equal(this.fake.requestsFor("answer")[1].reasoning, reasoning);
});

Given("answer calls are hedged after {int} ms", function (this: HarnessWorld, afterMs: number) {
  this.config.hedgeAfterMs = afterMs;
});

Given("escalation is disabled", function (this: HarnessWorld) {
  this.config.escalation = false;
});

Given("a dossier token budget of {int}", function (this: HarnessWorld, budget: number) {
  this.config.dossierTokenBudget = budget;
});

Given("an answer batch size of {int}", function (this: HarnessWorld, size: number) {
  this.config.batchSize = size;
});

// ---------------------------------------------------------------- act

async function answer(world: HarnessWorld, playbook: CaseInput) {
  assert.ok(world.corpus, "a data room must be arranged first");
  const startedAt = Date.now();
  const { output, trace } = await runCase(playbook, {
    gateway: world.liveGateway ?? world.fake,
    corpus: world.corpus,
    config: world.config,
    priceCaps,
  });
  world.durationMs = Date.now() - startedAt;
  world.output = output;
  world.trace = trace;
}

When("the harness answers the playbook", async function (this: HarnessWorld) {
  assert.ok(this.playbook, "a playbook must be arranged first");
  await answer(this, this.playbook);
});

export { answer };

// ---------------------------------------------------------------- assert

let schemaValidator: ReturnType<Ajv2020["compile"]> | null = null;

export async function assertSchemaValid(world: HarnessWorld) {
  if (!schemaValidator) {
    const schema = JSON.parse(
      await readFile(path.join(repoRoot, "data/playbook/candidate-output-schema.json"), "utf8"),
    );
    schemaValidator = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  }
  const valid = schemaValidator(world.output);
  assert.ok(valid, JSON.stringify(schemaValidator.errors, null, 2));
}

Then("the output validates against the official output schema", async function (this: HarnessWorld) {
  await assertSchemaValid(this);
});

Then("every playbook question has exactly one answer", function (this: HarnessWorld) {
  const ids = this.playbook!.questions.map(({ questionId }) => questionId).sort();
  assert.deepEqual(Object.keys(this.output!.answers).sort(), ids);
});

Then("the output caseId equals the playbook caseId", function (this: HarnessWorld) {
  assert.equal(this.output!.caseId, this.playbook!.caseId);
});

Then(new RegExp(String.raw`^the answer to "([^"]+)" is ${VALUE}$`), function (
  this: HarnessWorld,
  questionId: string,
  rawValue: string,
) {
  const answer = this.output!.answers[questionId];
  assert.ok(answer, `no answer for ${questionId}`);
  assert.ok(Object.is(answer.value, parseValue(rawValue)), `got ${JSON.stringify(answer.value)}`);
});

Then("the answer to {string} cites no files", function (this: HarnessWorld, questionId: string) {
  assert.deepEqual(this.output!.answers[questionId].evidenceFileIds, []);
});

Then(
  "the answer to {string} cites exactly {string}",
  function (this: HarnessWorld, questionId: string, fileIds: string) {
    assert.deepEqual(
      [...this.output!.answers[questionId].evidenceFileIds].sort(),
      splitIds(fileIds).sort(),
    );
  },
);

Then("every answer is null and cites no files", function (this: HarnessWorld) {
  for (const [questionId, answer] of Object.entries(this.output!.answers)) {
    assert.equal(answer.value, null, questionId);
    assert.deepEqual(answer.evidenceFileIds, [], questionId);
  }
});

Then(
  "the question {string} was flagged for {string}",
  function (this: HarnessWorld, questionId: string, flag: string) {
    assert.ok(
      this.trace!.flags[questionId]?.includes(flag as never),
      `flags: ${JSON.stringify(this.trace!.flags[questionId])}`,
    );
  },
);

Then("the question {string} was escalated", function (this: HarnessWorld, questionId: string) {
  assert.ok(this.trace!.escalated.includes(questionId));
});

Then("the question {string} was not escalated", function (this: HarnessWorld, questionId: string) {
  assert.ok(!this.trace!.escalated.includes(questionId), `escalated: ${this.trace!.escalated}; flags: ${JSON.stringify(this.trace!.flags[questionId])}`);
});

Then("no question was flagged for {string}", function (this: HarnessWorld, flag: string) {
  for (const [questionId, flags] of Object.entries(this.trace!.flags)) {
    assert.ok(!flags.includes(flag as never), `${questionId}: ${flags}`);
  }
});

Then(/^(\d+) answer pass(?:es)? (?:was|were) run$/, function (this: HarnessWorld, passes: string) {
  const ran = (this.fake.requestsFor("answer").length > 0 ? 1 : 0) + (this.fake.requestsFor("consistency").length > 0 ? 1 : 0);
  assert.equal(ran, Number(passes));
});

Then("the question {string} was adjudicated", function (this: HarnessWorld, questionId: string) {
  assert.ok(this.trace!.adjudicated.includes(questionId), `adjudicated: ${this.trace!.adjudicated}`);
});

Then("the adjudicator saw both candidate answers for {string}", function (this: HarnessWorld, questionId: string) {
  const request = this.fake
    .requestsFor("verify")
    .find((candidate) => (candidate.meta?.questions as { questionId: string }[])[0]?.questionId === questionId);
  assert.ok(request, `no adjudication call for ${questionId}`);
  const prompt = promptText(request);
  const first = JSON.stringify(this.fake.answers.get(questionId)!.value);
  const second = JSON.stringify(this.fake.secondPassAnswers.get(questionId)!.value);
  assert.ok(prompt.includes(`"value":${first}`) && prompt.includes(`"value":${second}`), prompt.slice(-600));
});

Then(
  "the agent made at most {int} model calls for {string}",
  function (this: HarnessWorld, max: number, questionId: string) {
    const calls = this.fake
      .requestsFor("agent")
      .filter((request) => request.meta?.questionId === questionId).length;
    assert.ok(calls > 0 && calls <= max, `agent calls: ${calls}`);
  },
);

function answerPrompts(world: HarnessWorld): string[] {
  return world.fake.requestsFor("answer").map(promptText);
}

function documentBody(world: HarnessWorld, fileId: string): string {
  const document = world.corpus!.documents.find((doc) => doc.fileId === fileId);
  assert.ok(document, `unknown document ${fileId}`);
  const block = document.blocks[0];
  return block.kind === "text" ? block.text : block.rows.map((row) => row.join(" | ")).join("\n");
}

Then(
  "the answer prompt contains the full text of {string}",
  function (this: HarnessWorld, fileId: string) {
    const body = documentBody(this, fileId);
    for (const prompt of answerPrompts(this)) assert.ok(prompt.includes(body), `missing ${fileId}`);
  },
);

Then(
  "the answer prompt lists {string} only in the excluded index",
  function (this: HarnessWorld, fileId: string) {
    const body = documentBody(this, fileId);
    for (const prompt of answerPrompts(this)) {
      assert.ok(!prompt.includes(body), `${fileId} body leaked into the prompt`);
      const excluded = prompt.split("<excluded_documents>")[1]?.split("</excluded_documents>")[0] ?? "";
      assert.ok(excluded.includes(fileId), `${fileId} missing from excluded index`);
    }
  },
);

Then(
  "every answer prompt dossier is within {int} tokens",
  function (this: HarnessWorld, budget: number) {
    assert.ok(this.trace!.batches.length > 0);
    for (const batch of this.trace!.batches) {
      assert.ok(batch.dossierTokens <= budget, `dossier ${batch.dossierTokens} > ${budget}`);
      assert.equal(batch.mode, "retrieval");
    }
  },
);

Then(
  "the answer prompt for {string} contains {string}",
  function (this: HarnessWorld, questionId: string, text: string) {
    const request = this.fake
      .requestsFor("answer")
      .find((candidate) =>
        (candidate.meta?.questions as { questionId: string }[]).some(
          (question) => question.questionId === questionId,
        ),
      );
    assert.ok(request, `no answer request for ${questionId}`);
    assert.ok(promptText(request).includes(text));
  },
);

Then("the model was called {int} times", function (this: HarnessWorld, count: number) {
  assert.equal(this.fake.requests.length, count);
});

Then("the estimated cost is greater than {float} USD", function (this: HarnessWorld, cost: number) {
  assert.ok(this.output!.estimatedCostUsd > cost, `${this.output!.estimatedCostUsd}`);
});

Then("the run took less than {int} milliseconds", function (this: HarnessWorld, ms: number) {
  assert.ok(this.durationMs < ms, `${this.durationMs} ms`);
});

function assertSameBatch(world: HarnessWorld, ids: string[]) {
  const batch = world.trace!.batches.find((candidate) => candidate.questionIds.includes(ids[0]));
  assert.ok(batch, `no batch for ${ids[0]}`);
  for (const id of ids) {
    assert.ok(batch.questionIds.includes(id), `${id} not with ${ids[0]}: ${JSON.stringify(world.trace!.batches.map((b) => b.questionIds))}`);
  }
}

Then(
  "{string}, {string} and {string} were answered in the same batch",
  function (this: HarnessWorld, a: string, b: string, c: string) {
    assertSameBatch(this, [a, b, c]);
  },
);

Then("{string} and {string} were answered in the same batch", function (this: HarnessWorld, a: string, b: string) {
  assertSameBatch(this, [a, b]);
});

Then("the estimated cost is {float} USD", function (this: HarnessWorld, cost: number) {
  assert.ok(Math.abs(this.output!.estimatedCostUsd - cost) < 1e-9, `${this.output!.estimatedCostUsd}`);
});

export { estimateTokens };
