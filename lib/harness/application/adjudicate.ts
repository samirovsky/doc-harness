import type { Question } from "../domain/contract";
import { parseBatchAnswers } from "./batch-answers";
import type { Dossier } from "./dossier";
import type { LlmGateway, ReasoningEffort } from "./ports";
import { adjudicationUserPrompt, answerSystemPrompt, type CaseContext } from "./prompts";
import type { Candidate, RawAnswer } from "./reconcile";

const summary = (candidate: Candidate) => ({
  value: candidate.value,
  calc: candidate.calc,
  evidenceFileIds: candidate.evidenceFileIds,
  rationale: candidate.rationale,
});

/**
 * Settles a disagreement between two independent passes with a single model
 * call: the same dossier and evidence rules as the first pass, plus both
 * candidates' values and reasoning. One round trip (vs. several for the
 * tool-using agent); the verdict may differ from both candidates.
 */
export async function adjudicate(
  question: Question,
  first: Candidate,
  second: Candidate,
  dependencies: { gateway: LlmGateway; context: CaseContext; dossier: Dossier },
  options: { reasoning: ReasoningEffort; maxTokens: number; temperature: number; signal?: AbortSignal },
): Promise<RawAnswer | undefined> {
  const response = await dependencies.gateway.complete(
    {
      purpose: "verify",
      json: true,
      reasoning: options.reasoning,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      messages: [
        { role: "system", content: answerSystemPrompt(dependencies.context, dependencies.dossier.text) },
        { role: "user", content: adjudicationUserPrompt(question, JSON.stringify(summary(first)), JSON.stringify(summary(second))) },
      ],
      meta: { questions: [{ questionId: question.questionId, answerType: question.answerType }], dossierFileIds: dependencies.dossier.fileIds },
    },
    options.signal,
  );
  return parseBatchAnswers(response.content, [question]).get(question.questionId);
}
