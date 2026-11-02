import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaseInput, CaseOutput } from "../../lib/harness/domain/contract";
import { scoreAgainstKey } from "../../lib/harness/evaluation/score";
import { validateOfficial, type SchemaValidation } from "./schema";

export interface ApiCommandOptions {
  /** Project root (for the official schema). */
  root: string;
  /** Base URL of a running `npm run dev`, e.g. http://localhost:3000 */
  baseUrl: string;
  playbookPath: string;
  /** Answer key to score against; null disables scoring. */
  keyPath: string | null;
  outPath: string;
  fetchImpl?: typeof fetch;
}

export interface ApiCommandResult {
  status: number;
  durationMs: number;
  outPath: string;
  /** Whether the response was written to outPath (false when the server was unreachable). */
  saved: boolean;
  body: unknown;
  validation?: SchemaValidation;
  score?: ReturnType<typeof scoreAgainstKey>;
  error?: string;
}

/**
 * harness:api — POSTs the playbook to `<baseUrl>/api/answer` exactly like the
 * workspace runner (and the evaluator) do, measures request-to-response time,
 * saves the response, validates it, and scores it when an answer key exists.
 */
export async function runApiCommand(options: ApiCommandOptions): Promise<ApiCommandResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const playbookText = await readFile(options.playbookPath, "utf8");
  const playbook = JSON.parse(playbookText) as CaseInput;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/api/answer`;

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: playbookText });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return {
      status: 0,
      durationMs: Date.now() - startedAt,
      outPath: options.outPath,
      saved: false,
      body: null,
      error: `could not reach ${url}${cause ? ` (${cause})` : ""}: is \`npm run dev\` running?`,
    };
  }
  const text = await response.text();
  const durationMs = Date.now() - startedAt;

  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  await mkdir(path.dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);

  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : String(text).slice(0, 500);
    return { status: response.status, durationMs, outPath: options.outPath, saved: true, body, error: message };
  }

  const validation = await validateOfficial(options.root, body);
  let score: ApiCommandResult["score"];
  if (options.keyPath && existsSync(options.keyPath) && validation.valid) {
    const key = JSON.parse(await readFile(options.keyPath, "utf8")) as CaseOutput;
    score = scoreAgainstKey(body as CaseOutput, key, playbook.questions);
  }
  return { status: response.status, durationMs, outPath: options.outPath, saved: true, body, validation, score };
}
