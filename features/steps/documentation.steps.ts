import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Then } from "@cucumber/cucumber";
import { defaultConfig } from "@/lib/harness/application/config";
import { repoRoot } from "../support/practice";

const read = (relative: string) => readFile(path.join(repoRoot, relative), "utf8");

/** Source text with template-literal escapes removed (\` → `), as the program prints it. */
const printed = async (relative: string) => (await read(relative)).replace(/\\`/g, "`");

const COMMAND_SCRIPTS: Record<string, string> = {
  "harness:answer": "scripts/answer.ts",
  "harness:api": "scripts/api.ts",
  "harness:eval": "scripts/evaluate.ts",
  "harness:doctor": "scripts/doctor.ts",
  "harness:ingest": "scripts/ingest.ts",
  "harness:setup": "scripts/setup.ts",
  "harness:probe": "scripts/probe-model.ts",
};

function npmRunCommands(guide: string): Set<string> {
  return new Set([...guide.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map((match) => match[1]));
}

/** Rows of the defaults table: | `setting` (/ `setting`) | value (/ value) | … */
function documentedDefaults(guide: string): Map<string, string> {
  const defaults = new Map<string, string>();
  for (const line of guide.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const names = [...cells[1].matchAll(/`([A-Za-z]+)`/g)].map((match) => match[1]);
    if (names.length === 0 || !names.every((name) => name in defaultConfig)) continue;
    const values = cells[2].split("/").map((value) => value.trim().replace(/^`|`$/g, "").replace(/^"|"$/g, ""));
    names.forEach((name, index) => defaults.set(name, values[index]));
  }
  return defaults;
}

Then(
  "every {string} command in {string} is a script in package.json",
  async function (prefix: string, guideName: string) {
    assert.equal(prefix, "npm run");
    const scripts = (JSON.parse(await read("package.json")) as { scripts: Record<string, string> }).scripts;
    const commands = npmRunCommands(await read(guideName));
    assert.ok(commands.size > 5, `found only ${commands.size} commands`);
    for (const command of commands) assert.ok(command in scripts, `${guideName} documents unknown script "${command}"`);
  },
);

Then(
  "every flag shown for a harness command in {string} is declared by that command's script",
  async function (guideName: string) {
    const guide = await read(guideName);
    let checked = 0;
    for (const match of guide.matchAll(/npm run (harness:[a-z]+) -- ([^\n`|]*)/g)) {
      const script = COMMAND_SCRIPTS[match[1]];
      assert.ok(script, `no script mapping for ${match[1]}`);
      const source = await read(script);
      for (const flag of match[2].matchAll(/--([a-z][a-z-]*)/g)) {
        const name = flag[1];
        const declared = new RegExp(`(^|[\\s{,])"?${name}"?\\s*:\\s*\\{`, "m").test(source);
        assert.ok(declared, `${guideName}: ${match[1]} does not declare --${name} (${script})`);
        checked += 1;
      }
    }
    for (const match of guide.matchAll(/`(harness:[a-z]+) -- (--[a-z-]+)/g)) {
      const source = await read(COMMAND_SCRIPTS[match[1]]);
      const name = match[2].slice(2);
      assert.ok(new RegExp(`"?${name}"?\\s*:\\s*\\{`).test(source), `${guideName}: ${match[1]} does not declare --${name}`);
      checked += 1;
    }
    assert.ok(checked >= 10, `only ${checked} flags checked`);
  },
);

Then(
  "every setting in the defaults table of {string} equals its value in the pipeline configuration",
  async function (guideName: string) {
    const defaults = documentedDefaults(await read(guideName));
    assert.ok(defaults.size >= 10, `found only ${defaults.size} documented defaults`);
    for (const [name, value] of defaults) {
      const actual = String(defaultConfig[name as keyof typeof defaultConfig]);
      assert.equal(value, actual, `${guideName}: ${name} documented as ${value}, configured as ${actual}`);
    }
  },
);

Then("both guides quote {string}", async function (message: string) {
  for (const guideName of ["GUIDE.md", "GUIDE.fr.md"]) {
    assert.ok((await read(guideName)).includes(message), `${guideName} does not quote: ${message}`);
  }
});

Then("{string} prints {string}", async function (source: string, message: string) {
  assert.ok((await printed(source)).includes(message), `${source} does not contain: ${message}`);
});

Then(
  "{string} and {string} mention the same {string} commands",
  async function (english: string, french: string, prefix: string) {
    assert.equal(prefix, "npm run");
    assert.deepEqual([...npmRunCommands(await read(french))].sort(), [...npmRunCommands(await read(english))].sort());
  },
);

Then("{string} and {string} document the same defaults", async function (english: string, french: string) {
  assert.deepEqual(
    Object.fromEntries(documentedDefaults(await read(french))),
    Object.fromEntries(documentedDefaults(await read(english))),
  );
});
