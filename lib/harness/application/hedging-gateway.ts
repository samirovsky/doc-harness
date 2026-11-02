import type { CostLedger } from "../domain/cost";
import type { LlmGateway, LlmRequest, LlmResponse, Purpose } from "./ports";

export interface HedgePolicy {
  /** Fire the k-th duplicate when no response arrived after k × afterMs (0 disables). */
  afterMs: number;
  /** Maximum number of duplicates per call. */
  maxHedges: number;
  purposes: Purpose[];
  /** Optional transformation of hedge copies (e.g. lower reasoning effort to finish faster). */
  adapt?: (request: LlmRequest, hedgeNumber: number) => LlmRequest;
  /** Throughput assumed when estimating what an abandoned call generated (tokens/s). */
  assumedTokensPerSecond?: number;
}

/**
 * Tail-latency hedging (decorator). On this provider pool, latency for the
 * same work varies several-fold between attempts, independent of tokens.
 * When a call is slow, identical duplicates are fired on a schedule and the
 * first successful response wins. Losers are aborted, and each is still
 * booked at an estimated cost (see estimateAbandoned) because an aborted
 * request may have been billed.
 */
export class HedgingGateway implements LlmGateway {
  hedges = 0;

  constructor(
    private readonly inner: LlmGateway,
    private readonly ledger: CostLedger,
    private readonly policy: HedgePolicy,
  ) {}

  complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    if (this.policy.afterMs <= 0 || this.policy.maxHedges <= 0 || !this.policy.purposes.includes(request.purpose)) {
      return this.inner.complete(request, signal);
    }
    return new Promise<LlmResponse>((resolve, reject) => {
      const controllers: AbortController[] = [];
      const timers: ReturnType<typeof setTimeout>[] = [];
      let settled = false;
      let failures = 0;
      let firstError: unknown = null;

      const finish = () => {
        settled = true;
        timers.forEach(clearTimeout);
      };

      const startedAt: number[] = [];
      const launch = (hedgeNumber: number) => {
        const controller = new AbortController();
        const index = controllers.push(controller) - 1;
        startedAt.push(Date.now());
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        const attempt = hedgeNumber > 0 && this.policy.adapt ? this.policy.adapt(request, hedgeNumber) : request;
        this.inner.complete(attempt, combined).then(
          (response) => {
            if (settled) return;
            finish();
            controllers.forEach((other, otherIndex) => {
              if (otherIndex === index) return;
              other.abort(new Error("hedge lost"));
              this.ledger.record(
                `${request.purpose}:hedge-abandoned`,
                estimateAbandoned(response, request, startedAt[otherIndex], this.policy),
                undefined,
                true,
              );
            });
            resolve(response);
          },
          (error) => {
            if (settled) return;
            failures += 1;
            firstError ??= error;
            // Reject once every launched request has failed; a primary failing
            // before any hedge fails fast (the caller owns retries).
            if (failures >= controllers.length) {
              finish();
              reject(firstError);
            }
          },
        );
      };

      launch(0);
      for (let hedge = 1; hedge <= this.policy.maxHedges; hedge += 1) {
        timers.push(
          setTimeout(() => {
            if (settled || signal?.aborted) return;
            this.hedges += 1;
            launch(hedge);
          }, hedge * this.policy.afterMs),
        );
      }
    });
  }
}

/**
 * Estimate of what an abandoned (aborted) duplicate consumed, assuming it was
 * billed: the same prompt, and the larger of the winner's output and what it
 * could have generated while running. Priced at the rate the provider
 * actually charged the winner (prompt:completion weighted like the price
 * caps, 1:3); falls back to the price caps when no cost was reported.
 */
export function estimateAbandoned(
  winner: LlmResponse,
  request: LlmRequest,
  startedAt: number,
  policy: Pick<HedgePolicy, "assumedTokensPerSecond">,
): { promptTokens: number; completionTokens: number; costUsd: number | null } {
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const generated = Math.round(elapsedSeconds * (policy.assumedTokensPerSecond ?? 150));
  const promptTokens = winner.usage.promptTokens;
  const completionTokens = Math.min(request.maxTokens ?? 8_000, Math.max(winner.usage.completionTokens, generated));
  const paid = winner.usage.costUsd;
  if (typeof paid !== "number" || !Number.isFinite(paid) || paid <= 0) return { promptTokens, completionTokens, costUsd: null };
  const weightedWinner = winner.usage.promptTokens + 3 * winner.usage.completionTokens;
  const unitPrice = weightedWinner > 0 ? paid / weightedWinner : 0;
  return { promptTokens, completionTokens, costUsd: unitPrice * (promptTokens + 3 * completionTokens) };
}
