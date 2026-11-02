import type { Question } from "../domain/contract";
import type { Corpus } from "../domain/document";
import type { AgentToolbox } from "./agent-tools";
import { extractJsonObject } from "./json";
import type { ChatMessage, LlmGateway, ReasoningEffort } from "./ports";
import { agentSystemPrompt, agentUserPrompt, type CaseContext } from "./prompts";
import type { Candidate, RawAnswer } from "./reconcile";

export interface AgentOptions {
  maxSteps: number;
  reasoning: ReasoningEffort;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface AgentOutcome {
  answer?: RawAnswer;
  calls: number;
  error?: string;
}

export function documentCatalog(corpus: Corpus, roles: Map<string, string>): string {
  return corpus.documents
    .map((document) => `- ${document.fileId} [${roles.get(document.fileId) ?? "core"}]: ${document.title.slice(0, 140)}`)
    .join("\n");
}

function describePrevious(candidate: Candidate | undefined): string {
  if (!candidate) return "no usable answer";
  return JSON.stringify({
    value: candidate.value,
    calc: candidate.calc,
    evidenceFileIds: candidate.evidenceFileIds,
    flags: candidate.flags,
    rationale: candidate.rationale,
  });
}

/**
 * Bounded ReAct loop with native tool calls. Each step is one model call; the
 * loop ends at `final_answer`, at a parseable JSON answer in plain content,
 * or at the step limit (then the caller falls back to the first pass).
 */
export async function runAgent(
  question: Question,
  previous: Candidate | undefined,
  alternative: Candidate | undefined,
  dependencies: { gateway: LlmGateway; toolbox: AgentToolbox; context: CaseContext; catalog: string },
  options: AgentOptions,
): Promise<AgentOutcome> {
  const messages: ChatMessage[] = [
    { role: "system", content: agentSystemPrompt(dependencies.context, dependencies.catalog) },
    { role: "user", content: agentUserPrompt(question, describePrevious(previous), alternative ? describePrevious(alternative) : null) },
  ];
  let calls = 0;
  try {
    for (let step = 1; step <= options.maxSteps; step += 1) {
      if (step === options.maxSteps) {
        messages.push({ role: "user", content: "Final step: call final_answer now with your best supported answer." });
      }
      calls += 1;
      const response = await dependencies.gateway.complete(
        {
          purpose: "agent",
          messages,
          tools: dependencies.toolbox.specs,
          reasoning: options.reasoning,
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          meta: { questionId: question.questionId, step },
        },
        options.signal,
      );

      const final = response.toolCalls.find((call) => call.name === "final_answer");
      if (final) {
        const args = extractJsonObject(final.arguments || "{}") as Omit<RawAnswer, "questionId">;
        return { answer: { ...args, questionId: question.questionId }, calls };
      }
      if (response.toolCalls.length === 0) {
        try {
          const parsed = extractJsonObject(response.content) as Omit<RawAnswer, "questionId">;
          if ("value" in parsed) return { answer: { ...parsed, questionId: question.questionId }, calls };
        } catch {
          // fall through to a nudge
        }
        messages.push({ role: "assistant", content: response.content || "" });
        messages.push({ role: "user", content: "Use the tools to verify, then call final_answer." });
        continue;
      }
      messages.push({ role: "assistant", content: response.content || null, toolCalls: response.toolCalls });
      for (const call of response.toolCalls) {
        messages.push({ role: "tool", toolCallId: call.id, content: dependencies.toolbox.run(call.name, call.arguments) });
      }
    }
    return { calls, error: `step limit (${options.maxSteps}) reached` };
  } catch (error) {
    return { calls, error: (error as Error).message };
  }
}
