import { setDefaultTimeout, setWorldConstructor, World } from "@cucumber/cucumber";
import type { Corpus } from "@/lib/harness/domain/document";
import type { CaseInput, CaseOutput } from "@/lib/harness/domain/contract";
import type { HarnessConfig } from "@/lib/harness/application/config";
import type { RunTrace } from "@/lib/harness/application/run-case";
import type { LlmGateway } from "@/lib/harness/application/ports";
import type { IngestionResult } from "@/lib/harness/infrastructure/corpus/ingest";
import { FakeModel } from "./fake-model";

setDefaultTimeout(120_000);

export class HarnessWorld extends World {
  corpus: Corpus | null = null;
  playbook: CaseInput | null = null;
  fake = new FakeModel();
  liveGateway: LlmGateway | null = null;
  config: Partial<HarnessConfig> = {};
  output: CaseOutput | null = null;
  trace: RunTrace | null = null;
  durationMs = 0;
  canonical: { ok: boolean; value?: unknown } | null = null;
  toolResult = "";
  callCost = 0;
  tempRoot: string | null = null;
  ingestion: IngestionResult | null = null;
}

setWorldConstructor(HarnessWorld);
