/**
 * Cost accounting for every model call in a run. OpenRouter reports the
 * charged amount as `usage.cost`; when it is absent we fall back to an upper
 * bound computed from token counts at the provider price caps.
 */
export interface PriceCaps {
  /** USD per million prompt tokens. */
  promptPerMillion: number;
  /** USD per million completion tokens (reasoning tokens are billed as completion). */
  completionPerMillion: number;
}

export interface UsageLike {
  promptTokens: number;
  completionTokens: number;
  costUsd?: number | null;
}

export function costOfUsage(usage: UsageLike, caps: PriceCaps): number {
  if (typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd) && usage.costUsd >= 0) {
    return usage.costUsd;
  }
  return (
    (usage.promptTokens * caps.promptPerMillion + usage.completionTokens * caps.completionPerMillion) / 1_000_000
  );
}

export interface CostEntry {
  purpose: string;
  usage: UsageLike & { cachedTokens?: number; reasoningTokens?: number };
  costUsd: number;
  estimated: boolean;
  /** Wall-clock duration of the call, when measured. */
  ms?: number;
}

export class CostLedger {
  readonly entries: CostEntry[] = [];

  constructor(private readonly caps: PriceCaps) {}

  /** `estimated` marks entries whose cost was inferred rather than reported by the provider. */
  record(purpose: string, usage: CostEntry["usage"], ms?: number, estimated = false): void {
    this.entries.push({
      purpose,
      usage,
      costUsd: costOfUsage(usage, this.caps),
      estimated: estimated || !(typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)),
      ms,
    });
  }

  get totalUsd(): number {
    const total = this.entries.reduce((sum, entry) => sum + entry.costUsd, 0);
    return Math.round(total * 1e8) / 1e8;
  }

  get tokens() {
    return this.entries.reduce(
      (totals, { usage }) => ({
        prompt: totals.prompt + usage.promptTokens,
        completion: totals.completion + usage.completionTokens,
        cached: totals.cached + (usage.cachedTokens ?? 0),
        reasoning: totals.reasoning + (usage.reasoningTokens ?? 0),
      }),
      { prompt: 0, completion: 0, cached: 0, reasoning: 0 },
    );
  }
}
