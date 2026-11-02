import path from "node:path";
import { readFile } from "node:fs/promises";
import { ingestDataRoom, type IngestionResult } from "@/lib/harness/infrastructure/corpus/ingest";
import type { CaseInput, CaseOutput } from "@/lib/harness/domain/contract";

export const repoRoot = path.resolve(import.meta.dirname, "../..");
export const practiceManifest = path.join(repoRoot, "data/case/manifest.json");
export const practiceFilesDir = path.join(repoRoot, "data/case/files");
export const practiceCacheDir = path.join(repoRoot, ".cache/doc-harness");

let practice: Promise<IngestionResult> | null = null;

/** Ingests the practice data room once per test process (disk cache shared with dev). */
export function practiceIngestion(): Promise<IngestionResult> {
  practice ??= ingestDataRoom({
    manifestPath: practiceManifest,
    filesDir: practiceFilesDir,
    cacheDir: practiceCacheDir,
  });
  return practice;
}

export async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8")) as T;
}

export const practicePlaybook = () => readJson<CaseInput>("data/playbook/questions.json");
export const practiceKey = () => readJson<CaseOutput>("data/playbook/expected-output.json");
