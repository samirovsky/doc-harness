import { env } from "cloudflare:workers";

const createCacheTable = `
  CREATE TABLE IF NOT EXISTS candidate_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`;

const createRunsTable = `
  CREATE TABLE IF NOT EXISTS candidate_runs (
    run_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    duration_ms INTEGER,
    estimated_cost_usd REAL,
    output_json TEXT
  )
`;

let initialization: Promise<void> | undefined;

/** Returns the raw Cloudflare D1 binding, backed by SQLite. */
export function getSqlite(): D1Database {
  if (!env.DB) throw new Error("SQLite binding DB is unavailable");
  return env.DB;
}

/** Creates the optional key/value cache table on first use. */
export function initializeSqlite(): Promise<void> {
  initialization ??= getSqlite().batch([
    getSqlite().prepare(createCacheTable),
    getSqlite().prepare(createRunsTable),
  ]).then(() => undefined);
  return initialization;
}

export interface StoredRun {
  run_id: string;
  status: "running" | "complete" | "failed";
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  estimated_cost_usd: number | null;
  output_json: string | null;
}

export async function startStoredRun(): Promise<string> {
  await initializeSqlite();
  const runId = crypto.randomUUID();
  await getSqlite()
    .prepare("INSERT INTO candidate_runs (run_id, status, started_at) VALUES (?, 'running', ?)")
    .bind(runId, Date.now())
    .run();
  return runId;
}

export async function finishStoredRun(
  runId: string,
  result: { durationMs: number; estimatedCostUsd: number; output: unknown },
): Promise<void> {
  await initializeSqlite();
  await getSqlite()
    .prepare("UPDATE candidate_runs SET status = 'complete', finished_at = ?, duration_ms = ?, estimated_cost_usd = ?, output_json = ? WHERE run_id = ?")
    .bind(Date.now(), result.durationMs, result.estimatedCostUsd, JSON.stringify(result.output), runId)
    .run();
}

export async function failStoredRun(runId: string, error: unknown): Promise<void> {
  await initializeSqlite();
  await getSqlite()
    .prepare("UPDATE candidate_runs SET status = 'failed', finished_at = ?, output_json = ? WHERE run_id = ?")
    .bind(Date.now(), JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), runId)
    .run();
}

export async function listStoredRuns(limit = 20): Promise<StoredRun[]> {
  await initializeSqlite();
  const result = await getSqlite()
    .prepare("SELECT * FROM candidate_runs ORDER BY started_at DESC LIMIT ?")
    .bind(limit)
    .all<StoredRun>();
  return result.results;
}

export async function readCache<T>(key: string): Promise<T | null> {
  await initializeSqlite();
  const row = await getSqlite()
    .prepare("SELECT payload FROM candidate_cache WHERE cache_key = ?")
    .bind(key)
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) as T : null;
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  await initializeSqlite();
  await getSqlite()
    .prepare(`
      INSERT INTO candidate_cache (cache_key, payload, updated_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        updated_at = unixepoch()
    `)
    .bind(key, JSON.stringify(value))
    .run();
}
