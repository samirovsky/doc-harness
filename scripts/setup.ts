/**
 * First-time setup: creates .env from .env.example if it is missing (an
 * existing .env is never modified, except to store a key exported in the
 * shell when .env has none). The key is never printed.
 *
 *   npm run harness:setup
 *   OPENROUTER_API_KEY=<your key> npm run harness:setup
 */
import path from "node:path";
import { setupProject } from "./lib/env";

const root = path.resolve(import.meta.dirname, "..");
const report = await setupProject(root, process.env);
for (const line of report.lines) console.log(line);
