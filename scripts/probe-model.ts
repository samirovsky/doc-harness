/**
 * Capability probe for the fixed model (spike before tuning). Each probe is a
 * tiny call; total cost is printed. Usage: npm run harness:probe
 *  1. JSON mode with reasoning off     4. image input (first image in the data room)
 *  2. reasoning effort low              5. implicit prompt caching (same prefix twice)
 *  3. native tool calling
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { openRouterRequestDefaults } from "../lib/challenge/openrouter";
import type { LlmRequest, LlmResponse } from "../lib/harness/application/ports";
import { OpenRouterGateway } from "../lib/harness/infrastructure/llm/openrouter-gateway";
import { imageMimeType } from "../lib/harness/infrastructure/parsers/image";
import { loadDotEnv } from "./lib/env";

const root = path.resolve(import.meta.dirname, "..");
loadDotEnv(root);
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY missing: run `npm run harness:setup` and put your key in .env");
const gateway = new OpenRouterGateway({ apiKey, defaults: openRouterRequestDefaults, baseUrl: process.env.OPENROUTER_BASE_URL || undefined, maxRetries: 0 });
let total = 0;

async function probe(name: string, request: LlmRequest, check: (response: LlmResponse) => string) {
  const startedAt = Date.now();
  try {
    const response = await gateway.complete(request);
    total += response.usage.costUsd ?? 0;
    console.log(`✔ ${name} (${Date.now() - startedAt} ms) ${check(response)} usage=${JSON.stringify(response.usage)}`);
  } catch (error) {
    console.log(`✘ ${name} (${Date.now() - startedAt} ms) ${(error as Error).message.slice(0, 400)}`);
  }
}

await probe(
  "json mode, reasoning off",
  { purpose: "answer", json: true, reasoning: "off", maxTokens: 200, messages: [{ role: "user", content: 'Reply with JSON {"sum": 17 + 25}' }] },
  (response) => `content=${response.content.slice(0, 120)}`,
);
await probe(
  "reasoning low",
  { purpose: "answer", json: true, reasoning: "low", maxTokens: 2000, messages: [{ role: "user", content: 'A ledger has 120000, 85000, 45000 (reversed, kept in gross) and 30000, plus an external receipt of 20000. Reply JSON {"gross": number, "net": number}.' }] },
  (response) => `content=${response.content.slice(0, 160)}`,
);
await probe(
  "tool calling",
  {
    purpose: "agent",
    reasoning: "off",
    maxTokens: 300,
    tools: [{ name: "calculate", description: "Exact arithmetic", parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } }],
    messages: [{ role: "user", content: "Use the calculate tool to compute 1320000 - 1056000." }],
  },
  (response) => `toolCalls=${JSON.stringify(response.toolCalls)}`,
);

const manifest = JSON.parse(await readFile(path.join(root, "data/case/manifest.json"), "utf8")) as { files: { fileId: string }[] };
const image = manifest.files.find((file) => imageMimeType(file.fileId));
if (image) {
  const bytes = await readFile(path.join(root, "data/case/files", image.fileId));
  await probe(
    `image input (${image.fileId})`,
    {
      purpose: "vision",
      reasoning: "off",
      maxTokens: 600,
      messages: [{ role: "user", content: [{ type: "text", text: "Transcribe the first 3 lines of text in this image." }, { type: "image_url", image_url: { url: `data:${imageMimeType(image.fileId)};base64,${bytes.toString("base64")}` } }] }],
    },
    (response) => `content=${response.content.slice(0, 160).replace(/\n/g, " / ")}`,
  );
}

const prefix = `Reference table:\n${Array.from({ length: 400 }, (_, i) => `row ${i} | code C-${1000 + i} | amount ${(i * 137) % 9973}`).join("\n")}`;
for (const attempt of [1, 2]) {
  await probe(
    `prompt caching attempt ${attempt}`,
    { purpose: "answer", json: true, reasoning: "off", maxTokens: 100, messages: [{ role: "system", content: prefix }, { role: "user", content: 'What is the amount of code C-1200? JSON {"amount": number}' }] },
    (response) => `content=${response.content.slice(0, 80)} cached=${response.usage.cachedTokens ?? "n/a"}`,
  );
}
console.log(`total probe cost $${total.toFixed(5)}`);
