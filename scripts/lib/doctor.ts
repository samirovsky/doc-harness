import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { openRouterRequestDefaults } from "../../lib/challenge/openrouter";
import { documentText } from "../../lib/harness/domain/document";
import { estimateTokens } from "../../lib/harness/domain/tokens";
import { ingestDataRoom } from "../../lib/harness/infrastructure/corpus/ingest";
import { KEY_NAME, readKey, type EnvLike } from "./env";
import { DATA_ROOM } from "./run";

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorOptions {
  root: string;
  env: EnvLike;
  offline: boolean;
  fetchImpl?: typeof fetch;
}

const REQUIRED_PACKAGES = ["vinext", "unpdf", "fflate", "fast-xml-parser", "papaparse", "tesseract.js", "@tesseract.js-data/eng"];
const ANSWER_TYPES = new Set(["number", "date", "text", "boolean"]);
const DEFAULT_API_BASE = "https://openrouter.ai/api/v1";
const LOW_OCR_CONFIDENCE = 60;

function versionAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

async function checkNode(root: string): Promise<Check> {
  const packagePath = path.join(root, "package.json");
  if (!existsSync(packagePath)) return { name: "Node.js", status: "warn", detail: `running ${process.versions.node}; no package.json to compare` };
  const engines = (JSON.parse(await readFile(packagePath, "utf8")) as { engines?: { node?: string } }).engines?.node ?? "";
  const minimum = engines.match(/(\d+\.\d+\.\d+)/)?.[1];
  if (!minimum) return { name: "Node.js", status: "pass", detail: `running ${process.versions.node}` };
  return versionAtLeast(process.versions.node, minimum)
    ? { name: "Node.js", status: "pass", detail: `running ${process.versions.node} (requires ${engines})` }
    : { name: "Node.js", status: "fail", detail: `running ${process.versions.node}, requires ${engines}`, fix: `Install Node.js ${minimum} or newer (see .nvmrc).` };
}

export function checkDependencies(root: string): Check {
  // Direct dependencies live in <root>/node_modules/<name>. Checking the folder (rather than
  // require.resolve) also works for packages whose "exports" hide package.json.
  const missing = REQUIRED_PACKAGES.filter((name) => !existsSync(path.join(root, "node_modules", ...name.split("/"), "package.json")));
  return missing.length === 0
    ? { name: "dependencies", status: "pass", detail: `${REQUIRED_PACKAGES.length} key packages installed` }
    : { name: "dependencies", status: "fail", detail: `missing: ${missing.join(", ")}`, fix: "Run `npm install` in the project folder." };
}

function checkKey(root: string, env: EnvLike): Check {
  return readKey(root, env)
    ? { name: "OpenRouter key", status: "pass", detail: `${KEY_NAME} is set (value not shown)` }
    : {
        name: "OpenRouter key",
        status: "fail",
        detail: `${KEY_NAME} is not set in the environment or in .env`,
        fix: `Run \`npm run harness:setup\`, then put your key after "${KEY_NAME}=" in .env.`,
      };
}

function checkProxy(env: EnvLike): Check {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (!proxy) return { name: "network proxy", status: "pass", detail: "no HTTPS proxy configured" };
  const fixes = [];
  if (env.NODE_USE_ENV_PROXY !== "1") fixes.push("export NODE_USE_ENV_PROXY=1 so the Node scripts (harness:*) use the proxy");
  if (!env.OPENROUTER_BASE_URL) fixes.push("set OPENROUTER_BASE_URL to an OpenRouter-compatible relay for `npm run dev` (the worker runtime cannot use HTTP proxies)");
  return fixes.length
    ? { name: "network proxy", status: "warn", detail: "an HTTPS proxy is configured", fix: fixes.join("; ") + "." }
    : { name: "network proxy", status: "pass", detail: "proxy configured; NODE_USE_ENV_PROXY=1 and OPENROUTER_BASE_URL are set" };
}

async function checkOpenRouter(root: string, env: EnvLike, fetchImpl: typeof fetch): Promise<Check[]> {
  const key = readKey(root, env);
  const base = (env.OPENROUTER_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, "");
  const model = openRouterRequestDefaults.model;
  const checks: Check[] = [];
  const unreachable = (error: unknown): Check => ({
    name: "OpenRouter account",
    status: "fail",
    detail: `cannot reach ${base}: ${(error as Error).message}`,
    fix: "Check your internet connection; behind a proxy, export NODE_USE_ENV_PROXY=1.",
  });

  if (!key) {
    checks.push({ name: "OpenRouter account", status: "warn", detail: "skipped: no key" });
  } else {
    try {
      const response = await fetchImpl(`${base}/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 401 || response.status === 403) {
        checks.push({ name: "OpenRouter account", status: "fail", detail: `key rejected (HTTP ${response.status})`, fix: `Check ${KEY_NAME} in .env (copy it again from openrouter.ai/keys).` });
      } else if (!response.ok) {
        checks.push({ name: "OpenRouter account", status: "fail", detail: `unexpected HTTP ${response.status} from ${base}/key` });
      } else {
        const data = ((await response.json()) as { data?: { usage?: number; limit?: number | null; limit_remaining?: number | null } }).data ?? {};
        const remaining = data.limit_remaining;
        const usage = typeof data.usage === "number" ? `$${data.usage.toFixed(4)} used` : "usage unknown";
        const credit = remaining === null || remaining === undefined ? "no credit limit" : `$${remaining.toFixed(4)} remaining`;
        checks.push(
          typeof remaining === "number" && remaining <= 0
            ? { name: "OpenRouter account", status: "fail", detail: `key valid but no credit left (${usage})`, fix: "Add credit on openrouter.ai or use another key." }
            : { name: "OpenRouter account", status: "pass", detail: `key valid; ${usage}; ${credit}` },
        );
      }
    } catch (error) {
      checks.push(unreachable(error));
    }
  }

  try {
    const response = await fetchImpl(`${base}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      checks.push({ name: "model", status: "fail", detail: `HTTP ${response.status} listing models at ${base}/models` });
    } else {
      const ids = (((await response.json()) as { data?: { id: string }[] }).data ?? []).map((entry) => entry.id);
      checks.push(
        ids.includes(model)
          ? { name: "model", status: "pass", detail: `${model} is available` }
          : { name: "model", status: "fail", detail: `${model} is not listed by ${base}/models`, fix: "Keep OPENROUTER_MODEL as in .env.example (the model is fixed by the case rules)." },
      );
    }
  } catch (error) {
    checks.push({ ...unreachable(error), name: "model" });
  }
  return checks;
}

async function checkDataRoom(root: string): Promise<Check> {
  const manifestPath = path.join(root, DATA_ROOM.manifest);
  const filesDir = path.join(root, DATA_ROOM.files);
  if (!existsSync(filesDir)) {
    return { name: "data room", status: "fail", detail: `${DATA_ROOM.files} not found`, fix: `Put the evidence files in ${DATA_ROOM.files}/.` };
  }
  const onDisk = (await readdir(filesDir)).filter((name) => !name.startsWith("."));
  if (!existsSync(manifestPath)) {
    return {
      name: "data room",
      status: "warn",
      detail: `${DATA_ROOM.manifest} not found; the ${onDisk.length} files in the folder will be used`,
      fix: `Add ${DATA_ROOM.manifest} listing the files.`,
    };
  }
  let listed: string[];
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files?: { fileId?: unknown }[] };
    listed = (manifest.files ?? []).map((file) => String(file.fileId ?? ""));
  } catch (error) {
    return { name: "data room", status: "fail", detail: `${DATA_ROOM.manifest} is not valid JSON: ${(error as Error).message}` };
  }
  const missing = listed.filter((fileId) => !onDisk.includes(fileId));
  const unlisted = onDisk.filter((name) => !listed.includes(name));
  if (missing.length) {
    return { name: "data room", status: "fail", detail: `listed in the manifest but missing on disk: ${missing.join(", ")}`, fix: `Add the files to ${DATA_ROOM.files}/ or fix the manifest.` };
  }
  if (unlisted.length) {
    return { name: "data room", status: "warn", detail: `${listed.length} files listed; not in the manifest (ignored): ${unlisted.join(", ")}` };
  }
  return { name: "data room", status: "pass", detail: `${listed.length} files listed and present` };
}

async function checkIngestion(root: string): Promise<Check> {
  try {
    const result = await ingestDataRoom({
      manifestPath: path.join(root, DATA_ROOM.manifest),
      filesDir: path.join(root, DATA_ROOM.files),
      cacheDir: path.join(root, DATA_ROOM.cache),
    });
    const empty = result.corpus.documents.filter((document) => documentText(document).trim().length === 0).map((document) => document.fileId);
    const lowOcr = result.corpus.documents
      .filter((document) => document.ocr && document.ocr.confidence < LOW_OCR_CONFIDENCE)
      .map((document) => `${document.fileId} (${document.ocr!.confidence})`);
    const tokens = result.corpus.documents.reduce((total, document) => total + estimateTokens(documentText(document)), 0);
    const cached = result.report.filter((entry) => entry.fromCache).length;
    const detail = `${result.corpus.documents.length} documents parsed in ${result.totalMs} ms (${cached} from cache), ~${tokens} tokens`;
    if (empty.length) return { name: "ingestion", status: "fail", detail: `${detail}; no text extracted from: ${empty.join(", ")}`, fix: "Check these files open correctly; scanned PDFs without a text layer are not supported." };
    if (lowOcr.length) return { name: "ingestion", status: "warn", detail: `${detail}; low OCR confidence: ${lowOcr.join(", ")} (sent to the model's vision input during runs)` };
    return { name: "ingestion", status: "pass", detail };
  } catch (error) {
    return { name: "ingestion", status: "fail", detail: `ingestion failed: ${(error as Error).message}` };
  }
}

async function checkPlaybook(root: string): Promise<Check> {
  const playbookPath = path.join(root, DATA_ROOM.playbook);
  if (!existsSync(playbookPath)) return { name: "playbook", status: "fail", detail: `${DATA_ROOM.playbook} not found` };
  try {
    const playbook = JSON.parse(await readFile(playbookPath, "utf8")) as { caseId?: unknown; questions?: { questionId?: unknown; answerType?: unknown; question?: unknown }[] };
    const questions = Array.isArray(playbook.questions) ? playbook.questions : [];
    const problems: string[] = [];
    if (typeof playbook.caseId !== "string") problems.push("caseId missing");
    if (questions.length === 0) problems.push("no questions");
    const ids = questions.map((question) => String(question.questionId ?? ""));
    if (new Set(ids).size !== ids.length) problems.push("duplicate questionId");
    const badTypes = questions.filter((question) => !ANSWER_TYPES.has(String(question.answerType))).length;
    if (badTypes) problems.push(`${badTypes} questions with an unknown answerType`);
    if (problems.length) return { name: "playbook", status: "fail", detail: problems.join("; ") };
    return { name: "playbook", status: "pass", detail: `${questions.length} questions for case "${playbook.caseId}"` };
  } catch (error) {
    return { name: "playbook", status: "fail", detail: `${DATA_ROOM.playbook} is not valid JSON: ${(error as Error).message}` };
  }
}

/** harness:doctor — every check a run depends on, with a fix for each problem. */
export async function runDoctor(options: DoctorOptions): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push(await checkNode(options.root));
  checks.push(checkDependencies(options.root));
  checks.push(checkKey(options.root, options.env));
  checks.push(checkProxy(options.env));
  if (!options.offline) checks.push(...(await checkOpenRouter(options.root, options.env, options.fetchImpl ?? fetch)));
  checks.push(await checkDataRoom(options.root));
  checks.push(await checkIngestion(options.root));
  checks.push(await checkPlaybook(options.root));
  return checks;
}

export function formatDoctorReport(checks: Check[]): string {
  const label: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const width = Math.max(...checks.map((check) => check.name.length));
  const lines = checks.flatMap((check) => {
    const line = `${label[check.status]}  ${check.name.padEnd(width)}  ${check.detail}`;
    return check.fix && check.status !== "pass" ? [line, `${" ".repeat(width + 8)}fix: ${check.fix}`] : [line];
  });
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  lines.push("", failures ? `${failures} problem(s) to fix before running.` : warnings ? `Ready, with ${warnings} warning(s).` : "All checks passed.");
  return lines.join("\n");
}
