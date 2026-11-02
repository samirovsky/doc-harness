/**
 * Node composition root: runs the full pipeline outside the browser and scores
 * it with the same rule as the workspace UI.
 *
 *   npm run harness:eval
 *   npm run harness:eval -- --questions q_001,q_012 --batch-size 4 --reasoning medium --no-escalation
 *
 * Writes outputs/eval-<timestamp>.json (output + trace + score). Requires
 * OPENROUTER_API_KEY (environment or .env).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { openRouterRequestDefaults } from "../lib/challenge/openrouter";
import type { HarnessConfig } from "../lib/harness/application/config";
import type { ReasoningEffort } from "../lib/harness/application/ports";
import { runCase } from "../lib/harness/application/run-case";
import type { CaseInput, CaseOutput } from "../lib/harness/domain/contract";
import { scoreAgainstKey } from "../lib/harness/evaluation/score";
import { ingestDataRoom } from "../lib/harness/infrastructure/corpus/ingest";
import { OpenRouterGateway } from "../lib/harness/infrastructure/llm/openrouter-gateway";

const root = path.resolve(import.meta.dirname, "..");

function loadDotEnv() {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const { values: args } = parseArgs({
  options: {
    questions: { type: "string" },
    "batch-size": { type: "string" },
    reasoning: { type: "string" },
    "agent-reasoning": { type: "string" },
    "no-escalation": { type: "boolean" },
    "no-triage": { type: "boolean" },
    playbook: { type: "string", default: "data/playbook/questions.json" },
    key: { type: "string", default: "data/playbook/expected-output.json" },
  },
});

loadDotEnv();
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set (environment or .env)");
  process.exit(1);
}

const config: Partial<HarnessConfig> = {};
if (args["batch-size"]) config.batchSize = Number(args["batch-size"]);
if (args.reasoning) config.answerReasoning = args.reasoning as ReasoningEffort;
if (args["agent-reasoning"]) config.agentReasoning = args["agent-reasoning"] as ReasoningEffort;
if (args["no-escalation"]) config.escalation = false;
if (args["no-triage"]) config.triage = false;

const ingestion = await ingestDataRoom({
  manifestPath: path.join(root, "data/case/manifest.json"),
  filesDir: path.join(root, "data/case/files"),
  cacheDir: path.join(root, ".cache/doc-harness"),
});
const playbook = JSON.parse(await readFile(path.join(root, args.playbook!), "utf8")) as CaseInput;
const wanted = args.questions?.split(",").map((id) => id.trim());
const input: CaseInput = wanted ? { ...playbook, questions: playbook.questions.filter((q) => wanted.includes(q.questionId)) } : playbook;

const startedAt = Date.now();
const { output, trace } = await runCase(input, {
  gateway: new OpenRouterGateway({ apiKey, defaults: openRouterRequestDefaults }),
  corpus: ingestion.corpus,
  priceCaps: {
    promptPerMillion: openRouterRequestDefaults.provider.max_price.prompt,
    completionPerMillion: openRouterRequestDefaults.provider.max_price.completion,
  },
  config,
  logger: { info: (m) => console.error(`· ${m}`), warn: (m) => console.error(`! ${m}`) },
});
const durationMs = Date.now() - startedAt;

const keyPath = path.join(root, args.key!);
const key = existsSync(keyPath) ? (JSON.parse(await readFile(keyPath, "utf8")) as CaseOutput) : null;
const score = key ? scoreAgainstKey(output, key, input.questions) : null;

const show = (value: unknown) => (value === undefined ? "missing" : JSON.stringify(value));
console.log("\nquestion  result  submitted → expected   [sources]   (source of answer, flags)");
for (const question of input.questions) {
  const row = score?.rows.find((candidate) => candidate.questionId === question.questionId);
  const detail = trace.answers[question.questionId];
  const mark = !row ? "  ?  " : row.correct ? "  ✓  " : row.valueMatches ? " src✗" : "  ✗  ";
  const expected = row && !row.correct ? ` → ${show(row.expected)} [${row.expectedSources.join(", ")}]` : "";
  console.log(
    `${question.questionId}  ${mark}  ${show(output.answers[question.questionId]?.value)}${expected}  [${output.answers[question.questionId]?.evidenceFileIds.join(", ")}]  (${detail.source}${detail.flags.length ? `; ${detail.flags.join(",")}` : ""})`,
  );
  if (row && !row.correct && detail.rationale) console.log(`          ↳ ${detail.rationale}`);
}

const tokens = trace.cost.tokens;
console.log(
  `\n${score ? `score ${score.correct}/${score.total} · ` : ""}duration ${(durationMs / 1000).toFixed(1)} s · cost $${output.estimatedCostUsd.toFixed(4)} ` +
    `(${trace.cost.calls} calls${trace.cost.estimatedCalls ? `, ${trace.cost.estimatedCalls} estimated` : ""}; ${JSON.stringify(trace.cost.byPurpose)}) · ` +
    `tokens in ${tokens.prompt} (cached ${tokens.cached}) / out ${tokens.completion} (reasoning ${tokens.reasoning}) · ` +
    `triage ${trace.triage.ok ? "ok" : "FAILED"} (${Object.values(trace.triage.roles).filter((role) => role === "archive").length} archived; as-of ${trace.triage.context.asOfDate}) · ` +
    `escalated ${trace.escalated.length}`,
);

await mkdir(path.join(root, "outputs"), { recursive: true });
const reportPath = path.join(root, "outputs", `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(reportPath, JSON.stringify({ output, trace, score, durationMs }, null, 2));
console.log(`report: ${path.relative(root, reportPath)}`);
