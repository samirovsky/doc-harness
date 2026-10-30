import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("practice package exposes exactly 30 named evidence files", async () => {
  const manifest = JSON.parse(await readFile(new URL("data/case/manifest.json", root), "utf8"));
  const diskFiles = (await readdir(new URL("data/case/files/", root))).sort();
  const manifestFiles = manifest.files.map((file) => file.fileId).sort();

  assert.equal(manifest.maximumFiles, 30);
  assert.equal(manifest.files.length, 30);
  assert.deepEqual(diskFiles, manifestFiles);
  assert.deepEqual(manifest.fileTypeCounts, { csv: 6, pdf: 9, docx: 2, pptx: 4, image: 3, xlsx: 6 });
  await Promise.all(manifestFiles.map((name) => access(new URL(`data/case/files/${name}`, root))));
});

test("playbook contains 50 single-answer questions with the expected type mix", async () => {
  const playbook = JSON.parse(await readFile(new URL("data/playbook/questions.json", root), "utf8"));
  const counts = Object.groupBy(playbook.questions, (question) => question.answerType);

  assert.equal(playbook.questions.length, 50);
  assert.equal(counts.number.length, 30);
  assert.equal(counts.date.length, 5);
  assert.equal(counts.text.length, 5);
  assert.equal(counts.boolean.length, 10);
  assert.equal(new Set(playbook.questions.map((question) => question.questionId)).size, 50);
  assert.ok(playbook.questions.every((question) => question.question && question.canonicalFormat));
  assert.doesNotMatch(JSON.stringify(playbook), /variableName|reasoningClass/);
});

test("answer schema uses the fixed question matrix contract", async () => {
  const [parsedSchema, playbook, expected, manifest] = await Promise.all([
    readFile(new URL("data/playbook/candidate-output-schema.json", root), "utf8").then(JSON.parse),
    readFile(new URL("data/playbook/questions.json", root), "utf8").then(JSON.parse),
    readFile(new URL("data/playbook/expected-output.json", root), "utf8").then(JSON.parse),
    readFile(new URL("data/case/manifest.json", root), "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(parsedSchema.required, ["caseId", "estimatedCostUsd", "answers"]);
  assert.equal(parsedSchema.properties.answers.type, "object");
  assert.deepEqual(parsedSchema.properties.answers.additionalProperties.required, ["value", "evidenceFileIds"]);
  assert.deepEqual(Object.keys(expected.answers).sort(), playbook.questions.map(({ questionId }) => questionId).sort());
  const expectedAnswers = Object.values(expected.answers);
  assert.equal(expectedAnswers.filter(({ value }) => value === null).length, 5);
  assert.ok(expectedAnswers.filter(({ value }) => value === null).every(({ evidenceFileIds }) => evidenceFileIds.length === 0));
  assert.ok(expectedAnswers.filter(({ value }) => value !== null).every(({ evidenceFileIds }) => evidenceFileIds.length > 0));
  assert.ok(Object.values(expected.answers).flatMap(({ evidenceFileIds }) => evidenceFileIds).every((fileId) => manifest.files.some((file) => file.fileId === fileId)));
});
