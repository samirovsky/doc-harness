import { writeCache } from "@/db";
import { openRouterRequestDefaults } from "@/lib/challenge/openrouter";
import type { CaseInput, CaseOutput } from "@/lib/challenge/types";
import { runCase, type RunTrace } from "@/lib/harness/application/run-case";
import { OpenRouterGateway } from "@/lib/harness/infrastructure/llm/openrouter-gateway";

/**
 * Candidate entrypoint — the composition root of the answer engine inside the
 * worker (workerd) runtime.
 *
 * The raw data room is parsed and OCR'd Node-side by the `docHarness()` Vite
 * plugin when the dev server starts (see build/doc-harness-plugin.ts) and
 * arrives here as a virtual module. This function wires the real adapters
 * (OpenRouter with the fixed model/provider policy) into the runtime-agnostic
 * pipeline in lib/harness/application/run-case.ts.
 */
export async function answerCase(input: CaseInput): Promise<CaseOutput> {
  const { default: dataRoom } = await import("virtual:doc-harness/corpus");

  const apiKey = typeof process !== "undefined" ? process.env.OPENROUTER_API_KEY : undefined;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set: copy .env.example to .env and add your key");

  // Optional override for networks where the worker runtime cannot reach openrouter.ai directly.
  const baseUrl = process.env.OPENROUTER_BASE_URL || undefined;
  const gateway = new OpenRouterGateway({ apiKey, defaults: openRouterRequestDefaults, baseUrl });
  const { output, trace } = await runCase(input, {
    gateway,
    corpus: dataRoom.corpus,
    priceCaps: {
      promptPerMillion: openRouterRequestDefaults.provider.max_price.prompt,
      completionPerMillion: openRouterRequestDefaults.provider.max_price.completion,
    },
    logger: { info: (message) => console.info(`[doc-harness] ${message}`), warn: (message) => console.warn(`[doc-harness] ${message}`) },
  });

  console.info(`[doc-harness] ${summarize(trace)}`);
  // Keep the latest trace (rationales, flags, escalations, per-call cost) for inspection.
  await writeCache(`doc-harness:trace:${input.caseId}`, trace).catch(() => undefined);
  return output;
}

function summarize(trace: RunTrace): string {
  const answered = Object.values(trace.answers).filter((answer) => answer.source !== "unanswered").length;
  return [
    `done in ${(trace.durationMs / 1000).toFixed(1)} s`,
    `cost $${trace.cost.totalUsd.toFixed(4)} over ${trace.cost.calls} calls`,
    `triage ${trace.triage.ok ? "ok" : "failed-open"}`,
    `batches ${trace.batches.filter((batch) => batch.ok).length}/${trace.batches.length}`,
    `escalated ${trace.escalated.length}`,
    `answered ${answered}/${Object.keys(trace.answers).length}`,
  ].join(" · ");
}
