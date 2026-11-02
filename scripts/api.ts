/**
 * Sends the playbook to a running `npm run dev` server at <url>/api/answer,
 * exactly like the workspace runner and the evaluator, then saves, validates
 * and (when an answer key exists) scores the response.
 *
 *   npm run harness:api
 *   npm run harness:api -- --url http://localhost:3000 --playbook data/playbook/questions.json --key data/playbook/expected-output.json
 *   npm run harness:api -- --no-score --out outputs/api.json
 *
 * Exits with code 1 on a non-200 response or an invalid payload.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import type { CaseOutput } from "../lib/harness/domain/contract";
import { runApiCommand } from "./lib/api";
import { DATA_ROOM, timestamp } from "./lib/run";

const root = path.resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    playbook: { type: "string", default: DATA_ROOM.playbook },
    key: { type: "string", default: DATA_ROOM.key },
    "no-score": { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const result = await runApiCommand({
  root,
  baseUrl: args.url!,
  playbookPath: path.resolve(root, args.playbook!),
  keyPath: args["no-score"] ? null : path.resolve(root, args.key!),
  outPath: path.resolve(root, args.out ?? `outputs/api-${timestamp()}.json`),
});

console.log(`POST ${args.url!.replace(/\/+$/, "")}/api/answer → HTTP ${result.status || "no response"} in ${(result.durationMs / 1000).toFixed(2)} s`);
if (result.error) {
  console.log(`error: ${result.error}`);
  process.exitCode = 1;
} else {
  const output = result.body as CaseOutput;
  const answers = Object.values(output.answers ?? {});
  const answered = answers.filter((answer) => answer.value !== null).length;
  console.log(`answered ${answered}/${answers.length} · estimatedCostUsd ${Number(output.estimatedCostUsd).toFixed(4)} · schema ${result.validation?.valid ? "valid" : "INVALID"}`);
  for (const error of result.validation?.errors ?? []) console.log(`  schema: ${error}`);
  if (result.score) {
    console.log(`score ${result.score.correct}/${result.score.total} (value + source, same rule as the workspace UI)`);
    for (const row of result.score.rows.filter((candidate) => !candidate.correct)) {
      console.log(
        `  ✗ ${row.questionId}: got ${JSON.stringify(row.submitted)} [${row.submittedSources.join(", ")}], expected ${JSON.stringify(row.expected)} [${row.expectedSources.join(", ")}]`,
      );
    }
  }
  process.exitCode = result.validation?.valid ? 0 : 1;
}
if (result.saved) console.log(`saved: ${path.relative(root, result.outPath)}`);
