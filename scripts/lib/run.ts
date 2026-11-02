import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openRouterRequestDefaults } from "../../lib/challenge/openrouter";
import type { HarnessConfig } from "../../lib/harness/application/config";
import type { LlmGateway, Logger } from "../../lib/harness/application/ports";
import { runCase, type RunTrace } from "../../lib/harness/application/run-case";
import type { CaseInput, CaseOutput } from "../../lib/harness/domain/contract";
import { ingestDataRoom } from "../../lib/harness/infrastructure/corpus/ingest";
import { OpenRouterGateway } from "../../lib/harness/infrastructure/llm/openrouter-gateway";
import { KEY_NAME, readKey, type EnvLike } from "./env";
import { validateOfficial, type SchemaValidation } from "./schema";

/** Default locations, relative to the project root (same as the dev server plugin). */
export const DATA_ROOM = {
  manifest: "data/case/manifest.json",
  files: "data/case/files",
  playbook: "data/playbook/questions.json",
  key: "data/playbook/expected-output.json",
  cache: ".cache/doc-harness",
} as const;

export const MISSING_KEY_MESSAGE = `${KEY_NAME} is not set: run \`npm run harness:setup\` and put your OpenRouter key in .env`;

export const priceCaps = {
  promptPerMillion: openRouterRequestDefaults.provider.max_price.prompt,
  completionPerMillion: openRouterRequestDefaults.provider.max_price.completion,
};

/** The production gateway: fixed model/provider policy, optional OPENROUTER_BASE_URL relay. */
export function createGateway(root: string, env: EnvLike, maxRetries?: number): LlmGateway {
  const apiKey = readKey(root, env);
  if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);
  return new OpenRouterGateway({
    apiKey,
    defaults: openRouterRequestDefaults,
    baseUrl: env.OPENROUTER_BASE_URL || undefined,
    maxRetries,
  });
}

export interface AnswerOptions {
  root: string;
  playbookPath: string;
  env: EnvLike;
  gateway?: LlmGateway;
  config?: Partial<HarnessConfig>;
  logger?: Logger;
}

/** Ingests the data room and answers a playbook exactly like answerCase() does in the worker. */
export async function answerPlaybook(options: AnswerOptions): Promise<{ output: CaseOutput; trace: RunTrace; durationMs: number }> {
  const gateway = options.gateway ?? createGateway(options.root, options.env);
  const ingestion = await ingestDataRoom({
    manifestPath: path.join(options.root, DATA_ROOM.manifest),
    filesDir: path.join(options.root, DATA_ROOM.files),
    cacheDir: path.join(options.root, DATA_ROOM.cache),
  });
  const playbook = JSON.parse(await readFile(options.playbookPath, "utf8")) as CaseInput;
  const startedAt = Date.now();
  const { output, trace } = await runCase(playbook, {
    gateway,
    corpus: ingestion.corpus,
    priceCaps,
    config: options.config,
    logger: options.logger,
  });
  return { output, trace, durationMs: Date.now() - startedAt };
}

export interface AnswerCommandOptions extends AnswerOptions {
  outPath: string;
  tracePath?: string;
}

export interface AnswerCommandResult {
  outPath: string;
  output: CaseOutput;
  trace: RunTrace;
  durationMs: number;
  validation: SchemaValidation;
}

/** harness:answer — writes exactly the payload the API returns, then validates it against the official schema. */
export async function runAnswerCommand(options: AnswerCommandOptions): Promise<AnswerCommandResult> {
  const { output, trace, durationMs } = await answerPlaybook(options);
  await mkdir(path.dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, `${JSON.stringify(output, null, 2)}\n`);
  if (options.tracePath) {
    await mkdir(path.dirname(options.tracePath), { recursive: true });
    await writeFile(options.tracePath, `${JSON.stringify(trace, null, 2)}\n`);
  }
  const validation = await validateOfficial(options.root, output);
  return { outPath: options.outPath, output, trace, durationMs, validation };
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
