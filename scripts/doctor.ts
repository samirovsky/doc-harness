/**
 * Preflight check of everything a run needs, with a fix for each problem.
 * Exits with code 1 when any check fails.
 *
 *   npm run harness:doctor              # includes free OpenRouter checks (key, model)
 *   npm run harness:doctor -- --offline # no network calls
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { formatDoctorReport, runDoctor } from "./lib/doctor";

const { values: args } = parseArgs({ options: { offline: { type: "boolean", default: false } } });
const root = path.resolve(import.meta.dirname, "..");
const checks = await runDoctor({ root, env: process.env, offline: Boolean(args.offline) });
console.log(formatDoctorReport(checks));
process.exitCode = checks.some((check) => check.status === "fail") ? 1 : 0;
