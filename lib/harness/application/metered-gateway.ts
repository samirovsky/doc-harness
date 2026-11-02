import type { CostLedger } from "../domain/cost";
import type { LlmGateway, LlmRequest, LlmResponse } from "./ports";

/** Records the usage of every successful call into the run's cost ledger. */
export class MeteredGateway implements LlmGateway {
  constructor(
    private readonly inner: LlmGateway,
    private readonly ledger: CostLedger,
  ) {}

  async complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    const response = await this.inner.complete(request, signal);
    this.ledger.record(request.purpose, response.usage);
    return response;
  }
}

/** Minimal promise-based concurrency limiter shared by all calls of a run. */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (run) {
      active += 1;
      run();
    }
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
  };
}

export type Limiter = ReturnType<typeof createLimiter>;
