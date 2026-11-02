/**
 * Cheap, tokenizer-free token estimate. GLM tokenizers average roughly 3.5–4
 * characters per token on English/numeric business text; 3.5 keeps budgets
 * conservative.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
