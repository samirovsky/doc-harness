import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { openRouterRequestDefaults } from "@/lib/challenge/openrouter";
import { runApiCommand, type ApiCommandResult } from "@/scripts/lib/api";
import { formatDoctorReport, runDoctor, type Check } from "@/scripts/lib/doctor";
import { setupProject, type SetupReport } from "@/scripts/lib/env";
import { runAnswerCommand, type AnswerCommandResult } from "@/scripts/lib/run";
import { validateOfficial } from "@/scripts/lib/schema";
import { repoRoot } from "../support/practice";
import type { HarnessWorld } from "../support/world";

interface ToolsWorld extends HarnessWorld {
  projectRoot?: string;
  setupReport?: SetupReport;
  doctorChecks?: Check[];
  doctorOutput?: string;
  fetchImpl?: typeof fetch;
  answerResult?: AnswerCommandResult;
  stubServer?: http.Server;
  stubUrl?: string;
  apiResult?: ApiCommandResult;
}

After({ tags: "@tools" }, async function (this: ToolsWorld) {
  if (this.stubServer) await new Promise((resolve) => this.stubServer!.close(resolve));
});

// ---------------------------------------------------------------- setup

Given("an empty project folder with a .env.example", async function (this: ToolsWorld) {
  this.projectRoot = await mkdtemp(path.join(os.tmpdir(), "doc-harness-tools-"));
  await copyFile(path.join(repoRoot, ".env.example"), path.join(this.projectRoot, ".env.example"));
});

Given("the project .env is set to {string}", async function (this: ToolsWorld, line: string) {
  await writeFile(path.join(this.projectRoot!, ".env"), `${line}\n`);
});

When("the setup command runs without a key in the environment", async function (this: ToolsWorld) {
  this.setupReport = await setupProject(this.projectRoot!, {});
});

When(
  "the setup command runs with the key {string} in the environment",
  async function (this: ToolsWorld, key: string) {
    this.setupReport = await setupProject(this.projectRoot!, { OPENROUTER_API_KEY: key });
  },
);

Then("a .env file exists with the content of .env.example", async function (this: ToolsWorld) {
  const env = await readFile(path.join(this.projectRoot!, ".env"), "utf8");
  const example = await readFile(path.join(this.projectRoot!, ".env.example"), "utf8");
  assert.equal(env, example);
  assert.equal(this.setupReport!.createdEnv, true);
});

Then("the setup report says the key still has to be set", function (this: ToolsWorld) {
  assert.equal(this.setupReport!.keySet, false);
  assert.ok(this.setupReport!.lines.join("\n").includes("OPENROUTER_API_KEY"), this.setupReport!.lines.join("\n"));
});

Then("the setup report says the key is set", function (this: ToolsWorld) {
  assert.equal(this.setupReport!.keySet, true);
});

Then(/^the project \.env (?:still )?contains "([^"]*)"$/, async function (this: ToolsWorld, text: string) {
  const env = await readFile(path.join(this.projectRoot!, ".env"), "utf8");
  assert.ok(env.split(/\r?\n/).includes(text), env);
});

Then("the setup report does not contain {string}", function (this: ToolsWorld, secret: string) {
  assert.ok(!this.setupReport!.lines.join("\n").includes(secret));
});

// ---------------------------------------------------------------- doctor

Given("a project folder with a valid tiny data room and playbook", async function (this: ToolsWorld) {
  const root = await mkdtemp(path.join(os.tmpdir(), "doc-harness-project-"));
  this.projectRoot = root;
  await mkdir(path.join(root, "data/case/files"), { recursive: true });
  await mkdir(path.join(root, "data/playbook"), { recursive: true });
  await writeFile(path.join(root, "data/case/files/ledger.csv"), "id,amount,status\nT-1,100,completed\nT-2,250,reversed\n");
  await writeFile(path.join(root, "data/case/files/register.csv"), "field,value\nRegistered name,Acme Signal Works\n");
  await writeFile(
    path.join(root, "data/case/manifest.json"),
    JSON.stringify({
      caseId: "tiny-case",
      files: [
        { fileId: "ledger.csv", format: "csv" },
        { fileId: "register.csv", format: "csv" },
      ],
    }),
  );
  await writeFile(
    path.join(root, "data/playbook/questions.json"),
    JSON.stringify({
      caseId: "tiny-case",
      questions: [
        { questionId: "q_001", question: "What is the registered name?", answerType: "text", canonicalFormat: "lowercase text" },
        { questionId: "q_002", question: "What amount was reversed?", answerType: "number", canonicalFormat: "raw number without units or separators" },
      ],
    }),
  );
  await copyFile(
    path.join(repoRoot, "data/playbook/candidate-output-schema.json"),
    path.join(root, "data/playbook/candidate-output-schema.json"),
  );
});

Given("the manifest also lists {string}", async function (this: ToolsWorld, fileId: string) {
  const manifestPath = path.join(this.projectRoot!, "data/case/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: { fileId: string; format: string }[] };
  manifest.files.push({ fileId, format: path.extname(fileId).slice(1) });
  await writeFile(manifestPath, JSON.stringify(manifest));
});

Given("OpenRouter accepts the key and lists the configured model", function (this: ToolsWorld) {
  this.fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/key")) return Response.json({ data: { usage: 0.5, limit: 20, limit_remaining: 19.5 } });
    if (url.endsWith("/models")) return Response.json({ data: [{ id: openRouterRequestDefaults.model }] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});

Given("OpenRouter rejects the key with status {int}", function (this: ToolsWorld, status: number) {
  this.fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/key")) return Response.json({ error: { message: "No auth credentials found", code: status } }, { status });
    if (url.endsWith("/models")) return Response.json({ data: [{ id: openRouterRequestDefaults.model }] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});

async function doctor(world: ToolsWorld, offline: boolean) {
  world.doctorChecks = await runDoctor({ root: world.projectRoot!, env: {}, offline, fetchImpl: world.fetchImpl });
  world.doctorOutput = formatDoctorReport(world.doctorChecks);
}

When("the doctor runs offline", async function (this: ToolsWorld) {
  await doctor(this, true);
});

When("the doctor runs online", async function (this: ToolsWorld) {
  await doctor(this, false);
});

function check(world: ToolsWorld, name: string): Check {
  const found = world.doctorChecks!.find((candidate) => candidate.name === name);
  assert.ok(found, `no check named "${name}" in:\n${world.doctorOutput}`);
  return found;
}

Then("the doctor reports {string} as {string}", function (this: ToolsWorld, name: string, status: string) {
  assert.equal(check(this, name).status, status, this.doctorOutput);
});

Then("the doctor fix for {string} mentions {string}", function (this: ToolsWorld, name: string, text: string) {
  assert.ok((check(this, name).fix ?? "").includes(text), this.doctorOutput);
});

Then("the doctor does not print {string}", function (this: ToolsWorld, secret: string) {
  assert.ok(!this.doctorOutput!.includes(secret), this.doctorOutput);
});

// ---------------------------------------------------------------- answer

When("the answer command runs with a scripted model", async function (this: ToolsWorld) {
  this.answerResult = await runAnswerCommand({
    root: this.projectRoot!,
    playbookPath: path.join(this.projectRoot!, "data/playbook/questions.json"),
    outPath: path.join(this.projectRoot!, "outputs/answers.json"),
    env: {},
    gateway: this.fake,
  });
});

Then("the answer file validates against the official output schema", async function (this: ToolsWorld) {
  const payload = JSON.parse(await readFile(this.answerResult!.outPath, "utf8"));
  const validation = await validateOfficial(this.projectRoot!, payload);
  assert.ok(validation.valid, validation.errors.join("\n"));
});

Then("the answer file has one answer per playbook question", async function (this: ToolsWorld) {
  const payload = JSON.parse(await readFile(this.answerResult!.outPath, "utf8")) as { answers: Record<string, unknown> };
  const playbook = JSON.parse(await readFile(path.join(this.projectRoot!, "data/playbook/questions.json"), "utf8")) as {
    questions: { questionId: string }[];
  };
  assert.deepEqual(Object.keys(payload.answers).sort(), playbook.questions.map((q) => q.questionId).sort());
});

// ---------------------------------------------------------------- api

async function startStub(world: ToolsWorld, handler: http.RequestListener) {
  world.stubServer = http.createServer(handler);
  await new Promise<void>((resolve) => world.stubServer!.listen(0, "127.0.0.1", resolve));
  world.stubUrl = `http://127.0.0.1:${(world.stubServer.address() as AddressInfo).port}`;
}

Given(
  "a stub answer server that returns the practice answer key plus an estimated cost",
  async function (this: ToolsWorld) {
    const key = JSON.parse(await readFile(path.join(repoRoot, "data/playbook/expected-output.json"), "utf8"));
    await startStub(this, (request, response) => {
      request.resume();
      request.on("end", () => {
        if (request.method !== "POST" || request.url !== "/api/answer") {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ...key, estimatedCostUsd: 0.0123 }));
      });
    });
  },
);

Given("a stub answer server that fails with {string}", async function (this: ToolsWorld, message: string) {
  await startStub(this, (request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(501, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: message }));
    });
  });
});

When("the api command sends the practice playbook to the stub server", async function (this: ToolsWorld) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "doc-harness-api-"));
  this.apiResult = await runApiCommand({
    root: repoRoot,
    baseUrl: this.stubUrl!,
    playbookPath: path.join(repoRoot, "data/playbook/questions.json"),
    keyPath: path.join(repoRoot, "data/playbook/expected-output.json"),
    outPath: path.join(outDir, "api.json"),
  });
});

Given("no answer server is running", async function (this: ToolsWorld) {
  // Reserve a free port, then close it so nothing listens there.
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise((resolve) => server.close(resolve));
  this.stubUrl = `http://127.0.0.1:${port}`;
});

Then("no api output file was written", function (this: ToolsWorld) {
  assert.equal(this.apiResult!.saved, false);
  assert.equal(existsSync(this.apiResult!.outPath), false);
});

Then("the api result has status {int}", function (this: ToolsWorld, status: number) {
  assert.equal(this.apiResult!.status, status);
});

Then("the api result validates against the official output schema", function (this: ToolsWorld) {
  assert.ok(this.apiResult!.validation?.valid, this.apiResult!.validation?.errors.join("\n"));
});

Then("the api score is {int} of {int}", function (this: ToolsWorld, correct: number, total: number) {
  assert.equal(this.apiResult!.score?.correct, correct);
  assert.equal(this.apiResult!.score?.total, total);
});

Then("the api error mentions {string}", function (this: ToolsWorld, text: string) {
  assert.ok((this.apiResult!.error ?? "").includes(text), this.apiResult!.error);
});
