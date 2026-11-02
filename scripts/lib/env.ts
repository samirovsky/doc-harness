import { existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type EnvLike = Record<string, string | undefined>;

export const KEY_NAME = "OPENROUTER_API_KEY";

/** Parses KEY=value lines (comments and blank lines ignored, matching quotes stripped, CRLF tolerated). */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

export function readDotEnv(root: string): Record<string, string> {
  const file = path.join(root, ".env");
  return existsSync(file) ? parseDotEnv(readFileSync(file, "utf8")) : {};
}

/** Copies .env values into `env` without overriding variables that are already set. */
export function loadDotEnv(root: string, env: EnvLike = process.env): void {
  for (const [name, value] of Object.entries(readDotEnv(root))) {
    if (!env[name]) env[name] = value;
  }
}

/** The OpenRouter key from the environment, else from .env. Never log the returned value. */
export function readKey(root: string, env: EnvLike): string | undefined {
  const fromEnv = env[KEY_NAME]?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = readDotEnv(root)[KEY_NAME]?.trim();
  return fromFile || undefined;
}

export interface SetupReport {
  createdEnv: boolean;
  keyWritten: boolean;
  keySet: boolean;
  lines: string[];
}

/**
 * First-time setup: creates .env from .env.example when missing (never
 * overwrites an existing .env) and, if the key is exported in the shell but
 * empty in .env, stores it there. The key itself is never printed.
 */
export async function setupProject(root: string, env: EnvLike): Promise<SetupReport> {
  const envPath = path.join(root, ".env");
  const examplePath = path.join(root, ".env.example");
  const lines: string[] = [];
  let createdEnv = false;
  let keyWritten = false;

  if (!existsSync(envPath)) {
    if (existsSync(examplePath)) await copyFile(examplePath, envPath);
    else await writeFile(envPath, `${KEY_NAME}=\n`);
    createdEnv = true;
    lines.push(`Created .env from ${existsSync(examplePath) ? ".env.example" : "scratch"}.`);
  } else {
    lines.push(".env already exists; it was not modified.");
  }

  const fileKey = parseDotEnv(await readFile(envPath, "utf8"))[KEY_NAME]?.trim();
  const shellKey = env[KEY_NAME]?.trim();
  if (!fileKey && shellKey) {
    const content = await readFile(envPath, "utf8");
    const pattern = new RegExp(`^\\s*${KEY_NAME}\\s*=.*$`, "m");
    const updated = pattern.test(content)
      ? content.replace(pattern, `${KEY_NAME}=${shellKey}`)
      : `${content}${content.endsWith("\n") || content === "" ? "" : "\n"}${KEY_NAME}=${shellKey}\n`;
    await writeFile(envPath, updated);
    keyWritten = true;
    lines.push(`Stored ${KEY_NAME} from your shell environment into .env (value not shown).`);
  }

  try {
    await chmod(envPath, 0o600);
  } catch {
    // Not supported on every platform (e.g. Windows); harmless.
  }

  const keySet = Boolean(fileKey || shellKey);
  if (keySet) {
    lines.push(`${KEY_NAME} is set.`);
    lines.push("Next: npm run harness:doctor");
  } else {
    lines.push(`${KEY_NAME} is not set yet: open .env and put your OpenRouter key after "${KEY_NAME}=".`);
    lines.push("Then: npm run harness:doctor");
  }
  return { createdEnv, keyWritten, keySet, lines };
}
