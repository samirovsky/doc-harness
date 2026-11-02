import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Then } from "@cucumber/cucumber";
import { readJson, repoRoot } from "../support/practice";

async function sourceFiles(relativeDir: string): Promise<string[]> {
  const root = path.join(repoRoot, relativeDir);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1] ?? match[2],
  );
}

function resolveImport(file: string, specifier: string): string {
  if (specifier.startsWith("@/")) return path.join(repoRoot, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(file), specifier);
  return specifier;
}

Then(
  "no module in {string} imports anything outside the domain layer",
  async function (layer: string) {
    const layerRoot = path.join(repoRoot, layer);
    for (const file of await sourceFiles(layer)) {
      for (const specifier of importsOf(await readFile(file, "utf8"))) {
        const target = resolveImport(file, specifier);
        assert.ok(target.startsWith(layerRoot), `${path.relative(repoRoot, file)} imports ${specifier}`);
      }
    }
  },
);

Then(
  "no module in {string} imports from {string}",
  async function (layer: string, forbidden: string) {
    const forbiddenRoot = path.join(repoRoot, forbidden);
    for (const file of await sourceFiles(layer)) {
      for (const specifier of importsOf(await readFile(file, "utf8"))) {
        const target = resolveImport(file, specifier);
        assert.ok(!target.startsWith(forbiddenRoot), `${path.relative(repoRoot, file)} imports ${specifier}`);
        assert.ok(
          target.startsWith(path.join(repoRoot, "lib/harness/domain")) ||
            target.startsWith(path.join(repoRoot, layer)),
          `${path.relative(repoRoot, file)} imports outer module ${specifier}`,
        );
      }
    }
  },
);

Then(
  "no module in {string} or {string} uses {string}, {string} or {string}",
  async function (first: string, second: string, needleA: string, needleB: string, needleC: string) {
    const needles = [needleA, needleB, needleC];
    for (const file of [...(await sourceFiles(first)), ...(await sourceFiles(second))]) {
      const source = await readFile(file, "utf8");
      for (const needle of needles) {
        assert.ok(!source.includes(needle), `${path.relative(repoRoot, file)} uses ${needle}`);
      }
    }
  },
);

async function harnessSources(): Promise<{ file: string; text: string }[]> {
  const files = [
    ...(await sourceFiles("lib/harness")),
    path.join(repoRoot, "lib/candidate/answer.ts"),
    path.join(repoRoot, "build/doc-harness-plugin.ts"),
  ];
  return Promise.all(files.map(async (file) => ({ file, text: (await readFile(file, "utf8")).toLowerCase() })));
}

Then("no harness source file mentions any practice file id", async function () {
  const manifest = await readJson<{ files: { fileId: string }[] }>("data/case/manifest.json");
  const ids = manifest.files.map(({ fileId }) => fileId.toLowerCase());
  for (const { file, text } of await harnessSources()) {
    for (const id of ids) assert.ok(!text.includes(id), `${path.relative(repoRoot, file)} mentions ${id}`);
  }
});

Then("no harness source file mentions any of {string}", async function (list: string) {
  const literals = list.split(",").map((literal) => literal.trim().toLowerCase());
  for (const { file, text } of await harnessSources()) {
    for (const literal of literals) {
      assert.ok(!text.includes(literal), `${path.relative(repoRoot, file)} mentions "${literal}"`);
    }
  }
});
