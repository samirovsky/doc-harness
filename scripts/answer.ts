/**
 * Runs the full pipeline from the command line (no browser, no scoring) and
 * writes exactly the JSON payload that /api/answer returns. Use it on any
 * case, including an unseen one without an answer key.
 *
 *   npm run harness:answer
 *   npm run harness:answer -- --playbook path/to/questions.json --out answers.json --trace trace.json
 *
 * Exits with code 1 if the payload does not validate against the official schema.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { loadDotEnv } from "./lib/env";
import { DATA_ROOM, runAnswerCommand, timestamp } from "./lib/run";

const root = path.resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    playbook: { type: "string", default: DATA_ROOM.playbook },
    out: { type: "string" },
    trace: { type: "string" },
  },
});
loadDotEnv(root);

const outPath = path.resolve(root, args.out ?? `outputs/answers-${timestamp()}.json`);
try {
  const result = await runAnswerCommand({
    root,
    playbookPath: path.resolve(root, args.playbook!),
    outPath,
    tracePath: args.trace ? path.resolve(root, args.trace) : undefined,
    env: process.env,
    logger: { info: (message) => console.error(`· ${message}`), warn: (message) => console.error(`! ${message}`) },
  });
  const answers = Object.values(result.output.answers);
  const answered = answers.filter((answer) => answer.value !== null).length;
  console.error(
    `answered ${answered}/${answers.length} (null: ${answers.length - answered}) · duration ${(result.durationMs / 1000).toFixed(1)} s · ` +
      `estimatedCostUsd ${result.output.estimatedCostUsd.toFixed(4)} · schema ${result.validation.valid ? "valid" : "INVALID"}`,
  );
  for (const error of result.validation.errors) console.error(`  schema: ${error}`);
  console.error(`written: ${path.relative(root, result.outPath)}`);
  process.exitCode = result.validation.valid ? 0 : 1;
} catch (error) {
  console.error(`harness:answer failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
