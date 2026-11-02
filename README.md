# Andor Case Lab

A time-boxed recruiting challenge for building a precise, fast, and token-efficient answer engine over a raw mixed-format investigation corpus.

## Start here

```bash
npm install
cp .env.example .env   # then set OPENROUTER_API_KEY
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

---

# Candidate solution — `doc-harness`

## Run it

```bash
npm install
cp .env.example .env          # set OPENROUTER_API_KEY
npm run dev                   # ingestion (parse + OCR) starts automatically
```

Open `/workspace` and press **Start analysis**. Other entry points:

| Command | What it does |
|---|---|
| `npm run harness:eval` | Full pipeline in Node + the UI's scoring rule, per-question matrix, writes `outputs/eval-*.json` (`--questions q_001,q_012`, `--batch-size`, `--reasoning`, `--no-escalation`, `--no-triage`) |
| `npm run harness:ingest [-- <fileId>]` | Shows what the parsers extracted (token sizes, OCR confidence, or one rendered document) |
| `npm run harness:probe` | Tiny capability probes of the fixed model (JSON mode, reasoning, tools, vision, caching) |
| `npm run test:bdd` | Offline Gherkin acceptance suite (`features/*.feature`, fake model) |
| `npm run test:bdd:live` | `@live` acceptance gate on the practice case (≥ 46/50, < $0.10, < 45 s) |
| `npm run test:unit` | `node:test` unit tests |
| `npm test` | Upstream build + tests, then unit + offline BDD |

## Architecture and technical choices

```
npm run dev ─► Vite plugin docHarness() (Node)                       answerCase()  (workerd)
               manifest → parsers → OCR → content-hash cache ──► virtual:doc-harness/corpus
                                                                        │
     ┌──────────────────────────────── runCase (lib/harness/application) ┘
     │ 0 vision fallback  (only images whose local OCR is weak)
     │ 1 triage           1 call: core / reference / archive + subject + as-of date (fail-open)
     │ 2 dossier          non-archive docs as one stable prefix; BM25 chunks per batch if > 60K tokens
     │ 3 answer batches   ~6 questions/call, all batches in parallel, JSON {value, calc, evidence, confidence}
     │ 4 reconcile        canonicalize · evaluate `calc` in code · normalize/ground evidence · flag
     │ 5 escalate         flagged answers only → ReAct agent with search_corpus / read_document /
     │                    query_table / calculate / final_answer (≤ 6 steps, capped count)
     └ 6 assemble         schema-valid CaseOutput + summed OpenRouter usage.cost
```

**Why ingestion is a Vite plugin.** `@cloudflare/vite-plugin` runs `answerCase` inside **workerd**: no filesystem, no runtime WASM compilation, no `eval`/`new Function`. Parsing and OCR therefore run in the Vite Node process when `npm run dev` starts (the "automatic preprocessing" the brief asks for). The normalized corpus reaches the worker as a virtual module. The answering core is pure TypeScript with no Node APIs, so the same code runs in workerd, in the Node eval CLI and in tests.

**Clean architecture.** `domain/` (pure: document model, canonicalization, arithmetic, BM25, table-query DSL, output validator, cost) ← `application/` (use cases + ports: `LlmGateway`) ← `infrastructure/` (parsers, OCR, OpenRouter adapter, corpus cache) ← composition roots (`lib/candidate/answer.ts`, `scripts/evaluate.ts`). The dependency rule, workerd-safety and "no practice literals" are enforced as BDD scenarios.

**Parsing.** I wrote small, format-specific readers rather than using a generic "file to text" tool, because structure (tables, slides, sheets) carries meaning.
- **PDF** (`unpdf`): text runs regrouped into lines by baseline, with ` | ` inserted at column gaps, so every table row stays on one line.
- **XLSX**: a namespace-agnostic SpreadsheetML reader (fflate + fast-xml-parser). The practice workbooks use `x:`-prefixed XML written by the OpenXML SDK, which exceljs cannot open. The reader handles shared strings, cached formula results, date styles, and hidden sheets and comments.
- **PPTX**: slide order from `presentation.xml`; text, tables, chart caches, SmartArt and speaker notes.
- **DOCX**: body order with tables kept in place, plus headers, footers, footnotes and comments.
- **CSV**: papaparse.
- **Images**: offline **tesseract.js**, with the English model bundled from npm (no CDN). It retries on an inverted grayscale copy for light-on-dark designs. Only low-confidence images go to GLM vision during the run.
- **Cache**: results are cached by `sha256(content)`, so renamed or replaced files can never serve stale text.

**Agentic, but only where it pays.** A first pass over the whole dossier answers most questions in a single round trip. Deterministic checks then decide which answers deserve the slower tool-using agent:
- an invalid canonical value;
- a `calc` that disagrees with the stated value;
- low confidence;
- missing evidence.

Counting and summing are done by code (`calculate`, `query_table`), never by the model's mental arithmetic.

## Precision, cost and speed

- **Precision.**
  - *Authority triage* keeps self-declared archives (~80% of practice tokens) out of the prompt.
  - *Generic evidence rules* in the prompt cover authority, supersession, effective dates vs filing dates, scope/status filters, cross-source reconciliation without double counting, and null for unsupported or after-close questions.
  - *Arithmetic is recomputed in code* from the model's `calc` expression.
  - *Canonicalization is strict*: ambiguous values are rejected and escalated rather than guessed.
  - *Evidence ids are normalized* onto manifest ids, or grounded by locating the value in the corpus.
  - *Decisive-source citation*: the authoritative file plus the files that contributed operands.
- **Cost.**
  - One triage call on compact profiles (~14K tokens).
  - About 9 answer calls sharing an identical system prefix: rules plus the ~20K-token dossier, which is friendly to provider prompt caching.
  - JSON-only outputs with 25-word rationales.
  - Reasoning effort is `low` by default; the agent is used only on flagged answers, capped at 12.
  - Cost is OpenRouter's reported `usage.cost`, summed over every call. If a provider omits it, the harness uses a token × price-cap estimate, an upper bound that is labelled in the trace.
- **Speed.**
  - Ingestion happens at server start and is cached, so it stays outside the measured run.
  - All answer batches and agents run concurrently behind one limiter, with per-call timeouts, retries on 429/5xx and an overall soft deadline.
  - Any failure degrades to `null` answers in a payload that still validates against the schema.

## Results on the practice case

> ⚠️ Pending live measurement: the build environment could not reach `openrouter.ai`. Run `npm run harness:eval` (or `npm run test:bdd:live`) to measure.
> Offline, the full chain was verified through the dev server: plugin → virtual module → workerd `answerCase` → schema-valid 50-answer payload.
> Estimates from prompt sizes: about 200K input and 25K output tokens, roughly **$0.03–0.06 per run**, and **15–35 s** wall-clock (dominated by the slowest batch plus any escalations).

## What I would improve (with more time)

1. **Self-consistency on disagreement.** *What:* run two first passes at different batch groupings and escalate only questions where they disagree, instead of trusting self-reported confidence. *Why:* Flash-class confidences are poorly calibrated; disagreement is a far better error signal. *How:* this costs about 2× the cheap pass and stays parallel, so latency barely changes.
2. **Typed fact extraction before answering.** *What:* build a fact table once per run (`entity, field, value, effective_date, status, source`) with per-document extraction calls, then answer from facts plus supersession rules applied in code. *Why:* effective-date and supersession logic becomes deterministic and testable, and the same table serves any question set.
3. **Scanned-PDF OCR and table detection in images.** *What:* rasterize pages without a text layer and OCR them. *How:* pdf.js render + tesseract, kept Node-side. *Why:* the unseen case may contain a scanned PDF.
4. **Evidence verification pass.** *What:* check that each cited file actually contains an operand (number or entity) of the answer. *Why:* removes over-citation and adds missing operand files, which matters if the private scorer checks source precision.
5. **Prompt-cache-aware scheduling.** *What:* send one batch first and fan out the rest once its prefill is cached. *How:* keep it only if `cached_tokens` shows a benefit for this provider pool. *Why:* it cuts input cost by up to ~5×.
6. **Embeddings for retrieval mode.** *What:* hybrid BM25 + small local embeddings. *Why:* better recall when questions paraphrase document labels. This only matters once a case outgrows the context budget.
