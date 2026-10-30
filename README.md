# Andor Case Lab

A time-boxed recruiting challenge for building a precise, fast, and token-efficient answer engine over a raw mixed-format investigation corpus.

## Start here

```bash
npm install
npm run dev
```

Open the local app after it starts. The first page contains the complete brief, provided files, fixed model rules, expected output format, and evaluation criteria.

## Candidate task

Write any functions or modules you need and connect them through `answerCase()` in `lib/candidate/answer.ts`. The test sends the questions to `app/api/answer/route.ts`; that endpoint calls `answerCase()`, which calls your pipeline. Your internal approach is entirely up to you.

We are not asking for a production-ready solution—just something that works end to end and that you can explain. Make sensible trade-offs and be prepared to discuss the architecture, tool choices, prompting strategy, reconciliation logic, and cost/latency decisions.

AI-assisted coding is strongly recommended and fully allowed. Candidates may use coding agents and other AI tools to build the solution; doing so is likely necessary to complete the mixed-format pipeline within the 3–4 hour time box.

Microsoft Office is not required. Claude or Codex can inspect spreadsheet files, or candidates can upload `.xls`/`.xlsx`, `.docx`, and `.pptx` files to Google Drive and open them for free with Google Sheets, Docs, and Slides. See [Google's instructions](https://support.google.com/docs/answer/9331167?hl=en) or this [two-minute Excel-to-Sheets video](https://www.youtube.com/watch?v=YqE7H9O_GXs).

## End-to-end evaluation contract

For the private evaluation, we will replace the practice files, manifest, questions, and answer key with a new unseen case using the same input and output contracts.
Do not overfit to practice filenames, values, indexes, or cached artifacts.
Your submitted repository must work end to end from the raw files after `npm install` and `npm run dev`, with any required parsing or preprocessing triggered automatically.

## What is provided

- 30 raw, mixed-format source files
- The practice question playbook, expected output, and output JSON schema
- An OpenRouter key and the fixed `z-ai/glm-5.3-flash` model configuration
- A minimal UI that invokes `answerCase()`, measures wall-clock duration, compares the returned JSON with the practice answer key, and renders a question-level result matrix
- A demo-run switch that previews the comparison UI before the candidate pipeline is implemented
- An optional ready-to-use SQLite database and connector
- A separate evaluation run using a different, unreleased corpus and question set

The candidate owns everything else: file parsing, OCR, indexing, retrieval, caching, prompts, model calls, agent or sub-agent orchestration, reconciliation, error handling, cost calculation, source attribution, canonicalization, and final JSON assembly. Build a custom harness or use any libraries and frameworks you prefer; what matters is the result and your ability to explain the choices behind it.

## What to submit

Submit the completed repository with:

1. **Your working implementation** — the complete harness and any code, dependencies, or supporting modules needed to run it end to end.
2. **A short decision note in this README** — explain your architecture and key technical choices, especially how they balance answer precision, model cost, and execution speed.
3. **A short improvement note in this README** — describe what you would improve with more time, how you would implement it, and why it would help.

```json
{
  "caseId": "practice-case",
  "estimatedCostUsd": 0.8421,
  "answers": {
    "q_041": {
      "value": true,
      "evidenceFileIds": ["01_transfer_ledger_sep.csv"]
    }
  }
}
```

Answers are keyed by question ID, so their order does not matter. Canonical values are raw JSON numbers, ISO dates, lowercase text, booleans, or `null`. Five practice questions are intentionally unsupported and resolve to `null`; every non-null answer must list at least one supporting source file.

## Repository map

- `data/case/files/` — 30 mixed-format practice evidence files
- `data/case/manifest.json` — stable file IDs and format metadata
- `data/playbook/questions.json` — 50 typed input questions
- `data/playbook/candidate-output-schema.json` — authoritative candidate answer format that `answerCase()` must return
- `data/playbook/expected-output.json` — worked example and complete practice answer key; it illustrates the format, but the schema is authoritative
- `lib/challenge/types.ts` — input and required output interfaces
- `lib/challenge/openrouter.ts` — supplied GLM 5.3 Flash request defaults and provider price ceiling
- `lib/candidate/answer.ts` — candidate implementation entrypoint
- `db/index.ts` — optional SQLite connector, run-history helpers, and mid-execution JSON cache
- `app/api/answer/route.ts` — HTTP entrypoint called by the test; it invokes `answerCase()`
