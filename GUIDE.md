# Usage guide

How to install, check, run and troubleshoot the document answer engine. For the architecture and the design decisions, see [README.md](README.md). A French version of this guide is in [GUIDE.fr.md](GUIDE.fr.md).

## 1. What it does

Given a data room (`data/case/files/` + `data/case/manifest.json`) and a playbook of questions (`data/playbook/questions.json`), it returns one JSON payload with a canonical answer, its source files and the estimated model cost. The payload follows `data/playbook/candidate-output-schema.json`. It uses the fixed OpenRouter model `z-ai/glm-5.3-flash`.

## 2. Prerequisites

- **Node.js 22.13.0 or newer** (see `.nvmrc` and `engines` in `package.json`) and npm.
- An **OpenRouter API key** (https://openrouter.ai/keys) with some credit. A full practice run reports a cost of about $0.015–0.075; it varies with the upstream provider.
- No other software: the PDF, Office and OCR parsers are npm packages, and the OCR language data ships with them (no download at runtime).

## 3. Quick start

```bash
npm install
npm run harness:setup        # creates .env from .env.example (never overwrites an existing .env)
```

Open `.env` and put your key after `OPENROUTER_API_KEY=`. Do not change `OPENROUTER_MODEL`: the case rules fix the model.

```bash
npm run harness:doctor       # checks everything; every line should be PASS (WARN is informational)
npm run dev
```

Open the URL printed by the dev server followed by `/workspace` (by default `http://localhost:3000/workspace`) and press **Start analysis**. The page shows the score, the duration and the estimated cost.

When `npm run dev` starts, it parses and OCRs the data room automatically. The terminal then prints a line like `[doc-harness] ingested 30 files in … ms (… from cache)`.

## 4. The helper commands

| Command | What it does |
|---|---|
| `npm run harness:setup` | Creates `.env` from `.env.example` if missing. If `OPENROUTER_API_KEY` is exported in your shell and empty in `.env`, it stores it there. It never prints the key. |
| `npm run harness:doctor` | Checks Node.js, dependencies, the key, the proxy settings, the OpenRouter account (key valid, remaining credit) and that the model is available, the data room, ingestion and the playbook. Prints `PASS` / `WARN` / `FAIL` with a fix for each problem; exits with code 1 if anything fails. The two OpenRouter checks are free (they do not call the model). |
| `npm run harness:doctor -- --offline` | Same checks, without any network call. |
| `npm run harness:answer` | Runs the full pipeline from the command line (no browser, no scoring) and writes exactly the JSON the API returns to `outputs/answers-<timestamp>.json`. It validates the file against the official schema and exits with code 1 if it is invalid. Use it for a case without an answer key. |
| `npm run harness:api` | Sends the playbook to a running `npm run dev` at `/api/answer`, the same path the workspace page and the evaluator use. It saves the response to `outputs/api-<timestamp>.json`, validates it, and scores it with the workspace rule when an answer key exists. |
| `npm run harness:eval` | Runs the pipeline in Node and prints a per-question matrix against the answer key: value, sources, how each answer was decided, and the timings of every call. It writes `outputs/eval-<timestamp>.json` (output, trace and score). |
| `npm run harness:ingest` | Shows what the parsers extracted from each file: number of blocks, estimated tokens, OCR confidence and warnings. |
| `npm run harness:ingest -- <fileId>` | Prints one document exactly as the model sees it. |
| `npm run harness:probe` | Small paid capability checks of the model (JSON mode, reasoning, tool calling, image input, prompt caching), costing about $0.001–0.002. |

Options (pass them after `--`):

```bash
npm run harness:answer -- --playbook path/to/questions.json --out answers.json --trace trace.json
npm run harness:api -- --url http://localhost:3000 --playbook data/playbook/questions.json --key data/playbook/expected-output.json
npm run harness:api -- --no-score --out outputs/api.json
npm run harness:eval -- --questions q_001,q_012 --batch-size 4 --reasoning medium --no-escalation --no-triage
```

`harness:eval` also accepts `--agent-reasoning <level>`, `--playbook <path>` and `--key <path>`. Reasoning levels are `off`, `low`, `medium` and `high`. The model does not allow reasoning to be switched off, so `off` is sent as the minimal effort.

## 5. Running a new case

1. Replace the evidence in `data/case/files/` and update `data/case/manifest.json` (one entry per file: `fileId` and `format`).
2. Replace `data/playbook/questions.json`. Add `data/playbook/expected-output.json` only if you have an answer key; without one, `harness:answer` and `harness:api -- --no-score` still work.
3. Run `npm run harness:doctor`. It confirms that every listed file exists, that every file yields text, and that the playbook is valid.
4. Run the case: in the browser (`npm run dev`, then `/workspace`) or with `npm run harness:answer`.

Notes:
- Nothing in the code depends on the practice files. File names, entities and values are all read from the data room.
- The parse cache in `.cache/doc-harness/` is keyed by file content, so renamed or replaced files are never served stale. Deleting `.cache/` is always safe; it only makes the next ingestion slower.
- While `npm run dev` is running, changes to the manifest or to `data/case/files/` trigger a new ingestion automatically.

## 6. Configuration

Environment variables (in `.env` or your shell):

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Required. Your OpenRouter key. |
| `OPENROUTER_MODEL` | Already set in `.env.example` to `z-ai/glm-5.3-flash`. Keep it: the case rules fix the model. |
| `OPENROUTER_BASE_URL` | Optional. An OpenRouter-compatible base URL, only for networks where the dev server cannot reach `openrouter.ai` directly (see §8). |
| `NODE_USE_ENV_PROXY=1` | Optional, behind an HTTPS proxy: makes the `harness:*` Node commands use `HTTPS_PROXY`. |

Pipeline defaults live in `lib/harness/application/config.ts`:

| Setting | Default | Meaning |
|---|---|---|
| `batchSize` | 6 | questions per model call (related questions are grouped together) |
| `concurrency` | 20 | maximum parallel model calls |
| `dossierTokenBudget` | 60000 | above this many tokens of relevant documents, each call gets retrieved excerpts instead of full documents |
| `answerReasoning` | `"low"` | reasoning effort of answer calls |
| `consistency` | `true` | run an independent second pass and settle disagreements |
| `consistencyGraceMs` | 5000 | how long to wait for the second pass after the first one finishes |
| `adjudicationBudgetMs` | 40000 | time budget for settling disagreements |
| `escalation` | `true` | send flagged answers to the tool-using agent |
| `escalationBudgetMs` | 20000 | time budget of the agent phase |
| `hedgeAfterMs` / `maxHedges` | 7000 / 2 | a call still pending after 7 s (and 14 s) gets a duplicate; the first answer wins |
| `deadlineMs` | 150000 | soft deadline of a run |

## 7. Outputs and traces

- `outputs/` holds the files written by `harness:answer`, `harness:api` and `harness:eval`. It is ignored by git.
- `.cache/doc-harness/` holds parsed documents, keyed by content hash. It is ignored by git.
- During browser runs, the full trace of the latest run (per-question rationale, flags, calls, costs) is stored in the app's local SQLite cache under the key `doc-harness:trace:<caseId>`. The dev server terminal also prints one summary line per run, starting with `[doc-harness] done in`.
- `harness:answer -- --trace <file>` writes the same trace to a file.

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The workspace shows `OPENROUTER_API_KEY is not set: copy .env.example to .env and add your key` | No key reached the dev server. Run `npm run harness:setup`, fill in `.env`, and restart `npm run dev`. |
| `harness:answer` prints `` harness:answer failed: OPENROUTER_API_KEY is not set: run `npm run harness:setup` and put your OpenRouter key in .env `` | Same fix as above. |
| `harness:eval` prints `OPENROUTER_API_KEY is not set (environment or .env)` | Same fix as above. |
| `harness:doctor` reports `OpenRouter account … key rejected (HTTP 401)` | The key is wrong or revoked. Copy it again from openrouter.ai/keys. |
| `harness:doctor` reports `cannot reach https://openrouter.ai/api/v1` | No internet access, or an HTTPS proxy. Behind a proxy, export `NODE_USE_ENV_PROXY=1` for the `harness:*` commands. |
| Behind a proxy, browser runs return only `null` answers and the dev server log shows `DNS lookup failed` | The worker runtime used by `npm run dev` cannot use HTTP proxies. Set `OPENROUTER_BASE_URL` to an OpenRouter-compatible relay that can reach `openrouter.ai`. |
| `harness:api` prints `` could not reach http://localhost:3000/api/answer (ECONNREFUSED): is `npm run dev` running? `` | Start `npm run dev` first, or pass `--url` with the URL it printed. |
| A run takes 60–90 s instead of the usual 15–45 s | OpenRouter routes each call to one of several upstream providers, and one of them is much slower for this model. The harness duplicates slow calls, but it cannot choose the provider: the case rules fix the provider policy. |
| `harness:doctor` warns about low OCR confidence | Those images (up to 4 MB each) are also sent to the model's image input during a run, so their text is still read. |

## 9. Tests

```bash
npm run test:unit         # unit tests (node:test)
npm run test:bdd          # offline acceptance scenarios (Gherkin, scripted model; no key, no network)
npm run test:bdd:live     # live acceptance gate on the practice case (needs the key; ≥ 46/50, < $0.10, < 45 s;
                          # the duration limit can fail when calls land on the slow provider, see §8)
npm test                  # production build + upstream tests + unit + offline scenarios
npm run lint
```
