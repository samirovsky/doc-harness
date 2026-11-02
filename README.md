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

**Practice result:** 50/50 in 10 of the last 12 live runs (worst 47/50), typically 16–43 s and $0.015–0.023 per run (measured; see [Results](#results-on-the-practice-case)).

## Run it

```bash
npm install
cp .env.example .env          # set OPENROUTER_API_KEY
npm run dev                   # ingestion (parse + OCR) starts automatically
```

Open `/workspace` and press **Start analysis**. Other entry points:

| Command | What it does |
|---|---|
| `npm run harness:eval` | Full pipeline in Node + the UI's scoring rule, per-question matrix, call timeline, writes `outputs/eval-*.json` (`--questions q_001,q_012`, `--batch-size`, `--reasoning`, `--no-escalation`, `--no-triage`) |
| `npm run harness:ingest [-- <fileId>]` | Shows what the parsers extracted (token sizes, OCR confidence, or one rendered document) |
| `npm run harness:probe` | Tiny capability probes of the fixed model (JSON mode, reasoning, tools, vision, caching) |
| `npm run test:bdd` | Offline Gherkin acceptance suite (`features/*.feature`, scripted fake model) |
| `npm run test:bdd:live` | `@live` acceptance gate on the practice case (≥ 46/50, < $0.10, < 45 s) |
| `npm run test:unit` | `node:test` unit tests |
| `npm test` | Upstream build + tests, then unit + offline BDD |

Behind a corporate HTTPS proxy: Node needs `NODE_USE_ENV_PROXY=1` for the CLI scripts. The worker runtime (workerd) cannot use the proxy at all, so set `OPENROUTER_BASE_URL` to an OpenRouter-compatible relay. Neither is needed on a normal network.

## Architecture and technical choices

```
npm run dev ─► Vite plugin docHarness() (Node)                       answerCase()  (workerd)
               manifest → parsers → OCR → content-hash cache ──► virtual:doc-harness/corpus
                                                                        │
     ┌──────────────────────────────── runCase (lib/harness/application) ┘
     │ 0 vision fallback  only images whose local OCR is weak
     │ 1 triage           1 call over compact profiles: archive / reference ids + subject + as-of date (fail-open)
     │ 2 dossier          non-archive docs as one stable, cacheable prefix; BM25 chunks per batch if > 60K tokens
     │ 3 answer batches   topic-clustered batches of ≤ 6 questions, all in parallel, hedged when slow;
     │                    JSON per question: rationale → calc → value → evidence → confidence
     │   + second pass    same batches re-sampled (temperature 0.7, reversed order), unhedged,
     │                    whatever finishes within 5 s of pass 1 is compared (self-consistency)
     │ 4 reconcile        canonicalize · evaluate `calc` in code · normalize/ground evidence · flag
     │ 5 settle           disagreements → derivation (if exactly one candidate is derived from other
     │                    questions) else one adjudication call with both candidates' reasoning;
     │                    other flags → ReAct agent (search_corpus / read_document / query_table /
     │                    calculate / final_answer), ≤ 6 steps, 20 s budget
     └ 6 assemble         recompute derived answers from their components' final values ·
                          schema-valid CaseOutput + summed OpenRouter usage.cost
```

**Why ingestion is a Vite plugin.** `@cloudflare/vite-plugin` runs `answerCase` inside **workerd**: no filesystem, no runtime WASM compilation, no `eval`/`new Function`. Parsing and OCR therefore run in the Vite Node process when `npm run dev` starts (the "automatic preprocessing" the brief asks for). The normalized corpus reaches the worker as a virtual module. The answering core is pure TypeScript with no Node APIs, so the same code runs in workerd (browser runner), in the Node eval CLI and in tests.

**Clean architecture.** `domain/` (pure: document model, canonicalization, arithmetic, BM25, table-query DSL, output validator, cost ledger) ← `application/` (use cases + ports: `LlmGateway`; decorators for metering and hedging) ← `infrastructure/` (parsers, OCR, OpenRouter adapter, corpus cache) ← composition roots (`lib/candidate/answer.ts`, `scripts/evaluate.ts`). The dependency rule, workerd-safety, the fixed model/provider policy and "no practice literals in the source" are executable BDD scenarios.

**BDD.** The behaviour was specified first as Gherkin features (`features/`: output contract, canonicalization, ingestion, triage and dossier, escalation, cost, batching and latency, architecture, self-consistency, the live practice gate), run red, then implemented layer by layer. 75 offline scenarios use a scripted fake model, so they are fast, deterministic and free.

**Parsing.** I wrote small, format-specific readers rather than using a generic "file to text" tool, because structure (tables, slides, sheets) carries meaning.
- **PDF** (`unpdf`): text runs regrouped into lines by baseline, with ` | ` inserted at column gaps, so every table row stays on one line.
- **XLSX**: a namespace-agnostic SpreadsheetML reader (fflate + fast-xml-parser). The practice workbooks use `x:`-prefixed XML written by the OpenXML SDK, which exceljs cannot open. The reader handles shared strings, cached formula results, date styles, and hidden sheets and comments.
- **PPTX**: slide order from `presentation.xml`; text, tables, chart caches, SmartArt and speaker notes.
- **DOCX**: body order with tables kept in place, plus headers, footers, footnotes and comments.
- **CSV**: papaparse.
- **Images**: offline **tesseract.js**, with the English model bundled from npm (no CDN). It retries on an inverted grayscale copy for light-on-dark designs (confidence 82–87 on the practice images). Only low-confidence images go to GLM vision during the run.
- **Cache**: results are cached by `sha256(content)`, so renamed or replaced files can never serve stale text.

**Agentic, but only where it pays.** One parallel first pass over the whole dossier answers most questions in a single round trip. Disagreements with the second pass are settled by derivation or by one adjudication call. Deterministic checks decide which other answers deserve the slower tool-using agent:
- an invalid canonical value;
- a `calc` that disagrees with the stated value;
- missing evidence;
- very low confidence.

Counting and summing are done by code (`calculate`, `query_table`), never by the model's mental arithmetic.

## Precision, cost and speed

**Precision.** These are the levers that took the practice score from 45/50 to 50/50:
- **Authority triage.** Self-declared archives (15 of 30 files, ~80% of tokens) never reach the answer prompt. Triage fails open. A triage that archives nothing while the corpus overflows the prompt budget is retried once; this happened in 1 of 35 runs and otherwise floods the prompt with distractors.
- **Generic evidence rules**, with no case literals:
  - authority, and supersession by later approved amendments or final closes;
  - effective dates vs filing dates;
  - row scope and status filters;
  - external items reconciled exactly once;
  - unique-id deduplication;
  - derived figures built from the headline component figures;
  - cross-checks against control figures, reading what they include;
  - `null` for unsupported or after-close questions.
- **Topic-coherent batching.** TF-IDF cosine clustering, capped at 6 questions, puts e.g. gross / reversed / net, or declared / delivered / difference, in the same call, so derived answers stay consistent with their components. This fixed the cross-question inconsistencies.
- **Rationale before value** in the JSON. A boolean then follows the comparison the model just wrote; this fixed "75,000 is not below 60,000 → true".
- **Derivation consistency.** A derived number can be written in terms of other questions (`calc: "q_012 - q_013"`). Code recomputes it from those questions' final answers, so a net, total or difference can never contradict its components. The model adopts this on its own for differences and nets.
- **Self-consistency instead of self-confidence.** Every miss I observed came with confidence ≥ 0.9, so self-reported confidence was useless as an error signal. A second, independently sampled pass is compared with the first.
  - On disagreement, a candidate derived from other questions wins outright; otherwise one adjudication call re-derives the answer with both candidates' reasoning in view. That's one round trip; the multi-step agent took 30–44 s.
  - In 17 live runs the target count (q_015) was always right, and q_014 disagreements were resolved correctly 5 times out of 6.
  - Limit: it cannot catch an error both passes share. One run had both passes misread the same "posted value" control figure (47/50).
- **Deterministic post-processing:**
  - `calc` is re-evaluated in code;
  - strict canonicalization that rejects rather than guesses;
  - evidence ids normalized onto the manifest, or grounded by locating the value in the corpus;
  - decisive-source citation (underlying records plus the final-figure document).

**Cost.**
- Triage on compact profiles (~14K tokens in, ~250 tokens out).
- About 9 answer calls of ~20K tokens sharing one identical system prefix. The provider's prompt cache serves 50–85% of input tokens on repeated runs.
- Short JSON outputs.
- The second pass adds about $0.005–0.008; adjudication and the agent run only on disagreements or flagged answers.
- `estimatedCostUsd` is the sum of OpenRouter's reported `usage.cost` over every call, plus an estimate for abandoned hedge duplicates, priced at the rate the provider actually charged the winner.
- The account's real usage after all 19 tuning runs, probes and browser runs was $0.37, below the sum the harness reported. The reported figure is conservative.

**Speed.**
- Ingestion runs at server start (cached), outside the measured window.
- All answer batches run concurrently behind one limiter.
- **Hedging:** a call still pending after 7 s (and again at 14 s) gets a duplicate at minimal reasoning; the first answer wins.
- **Self-consistency never waits:** second-pass batches not done 5 s after the first pass are abandoned (their cost is still booked). Adjudication is capped at 40 s and only runs on disagreements.
- **Bounds:** escalation is capped at 20 s, every call has a timeout and retries on 429/5xx, and any failure degrades to `null` answers in a payload that still validates against the schema.

**What I learned about the fixed model and provider pool** (measured with `harness:probe`, per-call traces and dedicated probes):
- **Reasoning is mandatory.** `reasoning.enabled=false` is rejected, so the lowest setting maps to `effort: minimal`.
- **JSON mode, tool calling and image input all work.**
- **Routing is per call** between at least two upstreams:
  - *Parasail* honours the effort setting and answers a 6-question batch in 2–5 s.
  - *OpenInference* produces 2–6K hidden reasoning tokens (16–33 s) whatever the effort, the reasoning budget or `/nothink`.
  - Identical or varied duplicates were routed back to OpenInference in my probes, so hedging only rescues spikes on the fast upstream.
- **Typically one batch per run lands on the slow upstream**, which sets the latency floor (~15–30 s). The provider policy is fixed by the brief, so I document this rather than fight it.

## Results on the practice case

Final configuration (self-consistency + derivation), last 12 live CLI runs (`harness:eval`):

| Metric | Value |
|---|---|
| Score | 50/50 in 10 runs; 49/50 once (adjudication picked the wrong candidate, which led to the derivation-precedence rule); 47/50 once (correlated error across both passes) |
| Duration | median 27.3 s (min 16.1 s, max 42.5 s) |
| Reported cost | median $0.017 (min $0.015, max $0.023) |
| q_015 ("completed or confirmed" count) | correct in all 17 self-consistency runs |

Earlier checkpoints:

| Run | Score | Duration | Reported cost |
|---|---|---|---|
| Workspace UI (browser → `route.ts` → workerd), before self-consistency | 50/50 (100%) | 30.1 s | $0.0109 |
| `test:bdd:live` gate | ≥ 46/50 ✓ | < 45 s ✓ | < $0.10 ✓ |

Tuning history:
1. **First live run:** 45/50, 60 s, $0.020.
2. **Prompt and batching fixes** (rationale first, derivation/consistency rules, topic batching): 50/50, but 41–57 s.
3. **Latency fixes** (compact triage, earlier hedges at minimal reasoning, bounded escalation): 14–30 s, but about 1 run in 4 missed the q_015 count by one.
4. **Self-consistency + derivation consistency:** the q_015 miss disappeared and q_014 disagreements are caught. About $0.007 more per run.
5. **Discarded experiments:**
   - A "prefer reported figures" rule broke the gross/net answers; it became a cross-check rule.
   - Hedging the second pass cost 12–20 extra calls per run for little gain.

The account's real usage for all tuning (about 40 runs, probes and browser runs) stayed well under $1 of the $20 credit.

## What I would improve (with more time)

1. **Decorrelated verification.** *What:* make the second pass answer through a different route, e.g. per-question with explicit row listing, or via the fact table below, rather than re-sampling the same prompt. *Why:* the remaining misses are errors both passes share (the same misread control figure); a different route would disagree and trigger adjudication.
2. **Streaming with time-to-first-token hedging.** *What:* stream responses, hedge when the first token is late, and cancel losers mid-stream. *Why:* OpenRouter stops billing cancelled streams on supported providers, which makes hedges nearly free; slow upstreams are also detectable from the first tokens.
3. **Typed fact extraction before answering.** *What:* build a per-run fact table (`entity, field, value, effective_date, status, source`) and apply supersession and effective-date rules in code. *Why:* reconciliation becomes deterministic and testable, and one extraction serves any question set.
4. **Scanned-PDF OCR.** *What:* rasterize pages without a text layer and OCR them. *How:* pdf.js render + tesseract, kept Node-side. *Why:* the unseen case may contain a scan.
5. **Evidence verification.** *What:* check that every cited file contains an operand of the answer. *Why:* tightens source precision in case the private scorer checks more than overlap.
6. **Hybrid retrieval for large rooms.** *What:* BM25 plus small local embeddings in retrieval mode. *Why:* better recall when questions paraphrase document labels. This only matters once a case exceeds the context budget.
