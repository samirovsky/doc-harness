/**
 * Fixed OpenRouter model and provider policy for the challenge.
 * Candidates must not change `model` or `provider`; all other request fields
 * and payload content may be adapted to their approach.
 * Prices are expressed in USD per million tokens, as required by OpenRouter.
 */
export const openRouterRequestDefaults = {
  model: process.env.OPENROUTER_MODEL ?? "z-ai/glm-5.3-flash",
  provider: {
    sort: "throughput",
    allow_fallbacks: true,
    max_price: {
      prompt: 0.2,
      completion: 0.6,
    },
  },
} as const;
