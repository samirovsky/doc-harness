import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

export const SCHEMA_PATH = "data/playbook/candidate-output-schema.json";

export interface SchemaValidation {
  valid: boolean;
  errors: string[];
}

/** Validates a payload against the authoritative output schema of the project at `root`. */
export async function validateOfficial(root: string, payload: unknown): Promise<SchemaValidation> {
  const schema = JSON.parse(await readFile(path.join(root, SCHEMA_PATH), "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const valid = validate(payload) as boolean;
  const errors = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`);
  return { valid, errors };
}
