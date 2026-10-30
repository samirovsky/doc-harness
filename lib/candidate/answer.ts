import type { CaseInput, CaseOutput } from "@/lib/challenge/types";

/**
 * Candidate entrypoint.
 *
 * Implement document parsing, retrieval, reconciliation and structured
 * extraction here. The source files are provided as-is. OpenRouter credentials
 * are supplied through environment variables; import the fixed model and
 * provider policy from `@/lib/challenge/openrouter`.
 * You own the complete pipeline and must report its estimated total cost.
 */
export async function answerCase(
  _input: CaseInput,
): Promise<CaseOutput> {
  void _input;
  throw new Error("Candidate implementation not yet provided");
}
