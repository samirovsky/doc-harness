import type { CostLedger } from "../domain/cost";
import type { LlmGateway, LlmRequest, LlmResponse, Purpose } from "./ports";

export interface HedgePolicy {
  /** Start a duplicate request when the first has not answered after this many ms (0 disables). */
  afterMs: number;
  purposes: Purpose[];
}

/**
 * Tail-latency hedging (decorator). Provider latency for identical work
 * varies several-fold; when a call is slow, an identical duplicate is fired
 * and the first successful response wins. The loser is aborted, and its cost
 * is still booked as an upper-bound estimate (winner's token counts at the
 * price caps), because an aborted request may have been billed.
 */
export class HedgingGateway implements LlmGateway {
  hedges = 0;

  constructor(
    private readonly inner: LlmGateway,
    private readonly ledger: CostLedger,
    private readonly policy: HedgePolicy,
  ) {}

  complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    if (this.policy.afterMs <= 0 || !this.policy.purposes.includes(request.purpose)) {
      return this.inner.complete(request, signal);
    }
    return new Promise<LlmResponse>((resolve, reject) => {
      const controllers: AbortController[] = [];
      let settled = false;
      let failures = 0;
      let firstError: unknown = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        settled = true;
        if (timer) clearTimeout(timer);
      };

      const launch = () => {
        const controller = new AbortController();
        const index = controllers.push(controller) - 1;
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        this.inner.complete(request, combined).then(
          (response) => {
            if (settled) return;
            finish();
            controllers.forEach((other, otherIndex) => {
              if (otherIndex === index) return;
              other.abort(new Error("hedge lost"));
              this.ledger.record(`${request.purpose}:hedge-abandoned`, {
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens,
                costUsd: null,
              });
            });
            resolve(response);
          },
          (error) => {
            if (settled) return;
            failures += 1;
            firstError ??= error;
            // Reject once every launched request has failed. A primary that fails
            // before the hedge timer fails fast: the caller owns retries.
            if (failures >= controllers.length) {
              finish();
              reject(firstError);
            }
          },
        );
      };

      launch();
      timer = setTimeout(() => {
        timer = undefined;
        if (settled || signal?.aborted) return;
        this.hedges += 1;
        launch();
      }, this.policy.afterMs);
    });
  }
}
