import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import ExcelJS from "exceljs";
import { documentText } from "@/lib/harness/domain/document";
import { ingestDataRoom } from "@/lib/harness/infrastructure/corpus/ingest";
import { practiceFilesDir, practiceIngestion } from "../support/practice";
import type { HarnessWorld } from "../support/world";

function documentById(world: HarnessWorld, fileId: string) {
  const document = world.corpus?.documents.find((doc) => doc.fileId === fileId);
  assert.ok(document, `no document ${fileId}`);
  return document;
}

Given("the practice data room is ingested", async function (this: HarnessWorld) {
  this.ingestion = await practiceIngestion();
  this.corpus = this.ingestion.corpus;
});

Then("every manifest file yields a document with content", function (this: HarnessWorld) {
  assert.equal(this.corpus!.documents.length, this.ingestion!.manifestFileIds.length);
  for (const document of this.corpus!.documents) {
    assert.ok(documentText(document).trim().length > 50, `${document.fileId} is empty`);
  }
});

Then(
  "the document {string} contains {string}",
  function (this: HarnessWorld, fileId: string, text: string) {
    assert.ok(documentText(documentById(this, fileId)).includes(text), `${fileId} lacks "${text}"`);
  },
);

Then(
  "a line of {string} contains both {string} and {string}",
  function (this: HarnessWorld, fileId: string, left: string, right: string) {
    const lines = documentText(documentById(this, fileId)).split("\n");
    assert.ok(lines.some((line) => line.includes(left) && line.includes(right)));
  },
);

Then(
  "the document {string} has a table {string} with column {string} and {int} rows",
  function (this: HarnessWorld, fileId: string, locator: string, column: string, rows: number) {
    const table = documentById(this, fileId).blocks.find(
      (block) => block.kind === "table" && block.locator.includes(locator),
    );
    assert.ok(table && table.kind === "table", `no table ${locator}`);
    assert.ok(table.header.includes(column), JSON.stringify(table.header));
    assert.equal(table.rows.length, rows);
  },
);

Then(
  "the document {string} has a table with column {string}",
  function (this: HarnessWorld, fileId: string, column: string) {
    const found = documentById(this, fileId).blocks.some(
      (block) => block.kind === "table" && block.header.includes(column),
    );
    assert.ok(found, `no table with column ${column} in ${fileId}`);
  },
);

Then(
  "the document {string} has an OCR confidence of at least {int}",
  function (this: HarnessWorld, fileId: string, minimum: number) {
    const confidence = documentById(this, fileId).ocr?.confidence ?? 0;
    assert.ok(confidence >= minimum, `confidence ${confidence}`);
  },
);

// ------------------------------------------------------- temporary rooms

async function createRoom(world: HarnessWorld, files: Record<string, Buffer | string>) {
  world.tempRoot = await mkdtemp(path.join(os.tmpdir(), "doc-harness-room-"));
  const filesDir = path.join(world.tempRoot, "files");
  await mkdir(filesDir);
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(filesDir, name), content);
  await writeManifest(world, Object.keys(files));
}

async function writeManifest(world: HarnessWorld, fileIds: string[]) {
  const manifest = {
    caseId: "temp-case",
    files: fileIds.map((fileId) => ({ fileId, format: path.extname(fileId).slice(1) })),
  };
  await writeFile(path.join(world.tempRoot!, "manifest.json"), JSON.stringify(manifest));
}

async function ingestRoom(world: HarnessWorld) {
  world.ingestion = await ingestDataRoom({
    manifestPath: path.join(world.tempRoot!, "manifest.json"),
    filesDir: path.join(world.tempRoot!, "files"),
    cacheDir: path.join(world.tempRoot!, "cache"),
  });
  world.corpus = world.ingestion.corpus;
}

Given(
  "a temporary data room copying {string} as {string}",
  async function (this: HarnessWorld, source: string, target: string) {
    await createRoom(this, {});
    await copyFile(path.join(practiceFilesDir, source), path.join(this.tempRoot!, "files", target));
    await writeManifest(this, [target]);
  },
);

Given(
  "a temporary data room with a CSV {string} containing {string}",
  async function (this: HarnessWorld, fileId: string, content: string) {
    await createRoom(this, { [fileId]: content.replaceAll("\\n", "\n") });
  },
);

Given(
  "a temporary data room with a generated workbook {string} holding a date cell and a formula",
  async function (this: HarnessWorld, fileId: string) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    sheet.addRow(["item", "effective", "base", "tripled"]);
    sheet.addRow(["alpha", new Date(Date.UTC(2025, 2, 4)), 100, { formula: "C2*3", result: 300 }]);
    sheet.getCell("B2").numFmt = "yyyy-mm-dd";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await createRoom(this, { [fileId]: buffer });
  },
);

When("the temporary data room is ingested", async function (this: HarnessWorld) {
  await ingestRoom(this);
});

When(
  "{string} is rewritten with {string} and the data room is ingested",
  async function (this: HarnessWorld, fileId: string, content: string) {
    await writeFile(path.join(this.tempRoot!, "files", fileId), content.replaceAll("\\n", "\n"));
    await ingestRoom(this);
  },
);

Then(
  "the corpus has a document {string} containing {string}",
  function (this: HarnessWorld, fileId: string, text: string) {
    assert.ok(documentText(documentById(this, fileId)).includes(text));
  },
);

Then("the last ingestion served {string} from cache", function (this: HarnessWorld, fileId: string) {
  assert.equal(this.ingestion!.report.find((entry) => entry.fileId === fileId)?.fromCache, true);
});

Then("the last ingestion parsed {string} afresh", function (this: HarnessWorld, fileId: string) {
  assert.equal(this.ingestion!.report.find((entry) => entry.fileId === fileId)?.fromCache, false);
});
