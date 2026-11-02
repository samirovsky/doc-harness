import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { ingestDataRoom, type IngestionResult } from "../lib/harness/infrastructure/corpus/ingest";

export const CORPUS_MODULE_ID = "virtual:doc-harness/corpus";
const RESOLVED_ID = `\0${CORPUS_MODULE_ID}`;

export interface DocHarnessPluginOptions {
  manifestPath?: string;
  filesDir?: string;
  cacheDir?: string;
}

/**
 * Node-side ingestion for the answer engine.
 *
 * Route handlers run inside workerd (Cloudflare runtime): no filesystem and
 * no runtime WASM compilation, so files cannot be parsed or OCR'd there. This
 * plugin parses the raw data room in the Vite (Node) process as soon as the
 * dev server starts, caches results by content hash, and serves the
 * normalized corpus to the worker as the virtual module
 * `virtual:doc-harness/corpus`. Changes to the data room invalidate it.
 */
export function docHarness(options: DocHarnessPluginOptions = {}): Plugin {
  let root = process.cwd();
  let ingestion: Promise<IngestionResult> | null = null;
  let log: (message: string) => void = (message) => console.log(message);

  const paths = () => ({
    manifestPath: path.resolve(root, options.manifestPath ?? "data/case/manifest.json"),
    filesDir: path.resolve(root, options.filesDir ?? "data/case/files"),
    cacheDir: path.resolve(root, options.cacheDir ?? ".cache/doc-harness"),
  });

  const start = () => {
    ingestion ??= (async () => {
      const result = await ingestDataRoom({ ...paths() });
      const cached = result.report.filter((entry) => entry.fromCache).length;
      const warnings = result.report.flatMap((entry) => entry.warnings.map((warning) => `${entry.fileId}: ${warning}`));
      log(`[doc-harness] ingested ${result.corpus.documents.length} files in ${result.totalMs} ms (${cached} from cache)`);
      for (const warning of warnings) log(`[doc-harness] warning ${warning}`);
      return result;
    })();
    ingestion.catch((error) => {
      log(`[doc-harness] ingestion failed: ${(error as Error).message}`);
      ingestion = null;
    });
    return ingestion;
  };

  const invalidate = (server: ViteDevServer) => {
    ingestion = null;
    for (const environment of Object.values(server.environments)) {
      const module = environment.moduleGraph.getModuleById(RESOLVED_ID);
      if (module) environment.moduleGraph.invalidateModule(module);
    }
    void start();
  };

  return {
    name: "doc-harness",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
      log = (message) => config.logger.info(message, { timestamp: true });
    },
    configureServer(server) {
      void start();
      const { manifestPath, filesDir } = paths();
      server.watcher.add([manifestPath, filesDir]);
      const onChange = (file: string) => {
        const resolved = path.resolve(file);
        if (resolved === manifestPath || resolved.startsWith(filesDir + path.sep)) invalidate(server);
      };
      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
    resolveId(id) {
      return id === CORPUS_MODULE_ID ? RESOLVED_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const result = await start();
      const payload = {
        caseId: result.caseId,
        manifestFileIds: result.manifestFileIds,
        corpus: result.corpus,
        ingestedAt: new Date().toISOString(),
      };
      return `export default ${JSON.stringify(payload)};`;
    },
  };
}
