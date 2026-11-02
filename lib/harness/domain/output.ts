import type { CaseOutput } from "./contract";

/**
 * Hand-written validator mirroring data/playbook/candidate-output-schema.json.
 * (ajv compiles schemas with runtime code generation, which workerd forbids;
 * the BDD suite separately validates outputs with ajv against the real file.)
 */
export function validateCaseOutput(candidate: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(candidate)) return ["output must be an object"];
  const keys = Object.keys(candidate).sort();
  if (keys.join(",") !== "answers,caseId,estimatedCostUsd") errors.push(`unexpected top-level keys: ${keys.join(",")}`);

  const output = candidate as Partial<CaseOutput>;
  if (typeof output.caseId !== "string") errors.push("caseId must be a string");
  if (typeof output.estimatedCostUsd !== "number" || !Number.isFinite(output.estimatedCostUsd) || output.estimatedCostUsd < 0) {
    errors.push("estimatedCostUsd must be a finite number >= 0");
  }
  if (!isPlainObject(output.answers)) return [...errors, "answers must be an object"];

  for (const [questionId, answer] of Object.entries(output.answers)) {
    if (!/^q_[A-Za-z0-9_-]+$/.test(questionId)) errors.push(`${questionId}: invalid question id`);
    if (!isPlainObject(answer)) {
      errors.push(`${questionId}: answer must be an object`);
      continue;
    }
    const answerKeys = Object.keys(answer).sort().join(",");
    if (answerKeys !== "evidenceFileIds,value") errors.push(`${questionId}: unexpected keys ${answerKeys}`);
    const { value, evidenceFileIds } = answer as { value: unknown; evidenceFileIds: unknown };
    const validValue =
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value));
    if (!validValue) errors.push(`${questionId}: invalid value type`);
    if (!Array.isArray(evidenceFileIds) || !evidenceFileIds.every((id) => typeof id === "string")) {
      errors.push(`${questionId}: evidenceFileIds must be an array of strings`);
      continue;
    }
    if (new Set(evidenceFileIds).size !== evidenceFileIds.length) errors.push(`${questionId}: duplicate evidence ids`);
    if (value !== null && evidenceFileIds.length === 0) errors.push(`${questionId}: non-null answer without evidence`);
  }
  return errors;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
