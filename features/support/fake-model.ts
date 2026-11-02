import type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmUsage,
} from "@/lib/harness/application/ports";

/**
 * Scripted test double for the LlmGateway port. It answers by request
 * purpose (triage / answer / agent / vision) using structured `meta` passed by
 * the harness, so tests never need to parse prompts to decide what to return.
 */
export interface ScriptedAnswer {
  value: unknown;
  calc?: string;
  evidence: string[];
  confidence?: number;
}

export type AgentBehavior =
  | { kind: "answer"; value: unknown; evidence: string[] }
  | { kind: "fail" }
  | { kind: "loop" };

export class FakeModel implements LlmGateway {
  readonly requests: LlmRequest[] = [];
  answers = new Map<string, ScriptedAnswer>();
  triageRoles = new Map<string, "core" | "reference" | "archive">();
  agentBehaviors = new Map<string, AgentBehavior>();
  defaultAgent: AgentBehavior = { kind: "fail" };
  failAll = false;
  failTriage = false;
  costPerCall: number | null = null;

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    if (this.failAll) throw new Error("scripted model failure");
    switch (request.purpose) {
      case "triage":
        if (this.failTriage) throw new Error("scripted triage failure");
        return this.reply(JSON.stringify(this.triagePayload(request)));
      case "answer":
        return this.reply(JSON.stringify(this.answerPayload(request)));
      case "agent":
        return this.agentReply(request);
      default:
        throw new Error(`unscripted purpose ${request.purpose}`);
    }
  }

  private usage(): LlmUsage {
    return { promptTokens: 1000, completionTokens: 100, costUsd: this.costPerCall };
  }

  private reply(content: string): LlmResponse {
    return { content, toolCalls: [], usage: this.usage() };
  }

  private triagePayload(request: LlmRequest) {
    const fileIds = (request.meta?.fileIds as string[]) ?? [];
    return {
      caseContext: { subject: "test subject", asOfDate: null },
      documents: fileIds.map((fileId) => ({
        fileId,
        role: this.triageRoles.get(fileId) ?? "core",
        reason: "scripted",
      })),
    };
  }

  private answerPayload(request: LlmRequest) {
    const questions =
      (request.meta?.questions as { questionId: string; answerType: string }[]) ?? [];
    const firstFile = ((request.meta?.dossierFileIds as string[]) ?? [])[0];
    return {
      answers: questions.map(({ questionId, answerType }) => {
        const scripted = this.answers.get(questionId);
        if (scripted) {
          return {
            questionId,
            value: scripted.value,
            calc: scripted.calc ?? null,
            evidenceFileIds: scripted.evidence,
            confidence: scripted.confidence ?? 0.95,
            rationale: "scripted",
          };
        }
        return {
          questionId,
          value: plausibleValue(answerType),
          calc: null,
          evidenceFileIds: firstFile ? [firstFile] : [],
          confidence: 0.95,
          rationale: "plausible default",
        };
      }),
    };
  }

  private agentReply(request: LlmRequest): LlmResponse {
    const questionId = String(request.meta?.questionId ?? "");
    const behavior = this.agentBehaviors.get(questionId) ?? this.defaultAgent;
    if (behavior.kind === "fail") throw new Error("scripted agent failure");
    if (behavior.kind === "loop") {
      return {
        content: "",
        toolCalls: [
          {
            id: `call_${this.requests.length}`,
            name: "calculate",
            arguments: JSON.stringify({ expression: "1 + 1" }),
          },
        ],
        usage: this.usage(),
      };
    }
    return {
      content: "",
      toolCalls: [
        {
          id: `call_${this.requests.length}`,
          name: "final_answer",
          arguments: JSON.stringify({
            value: behavior.value,
            evidenceFileIds: behavior.evidence,
            confidence: 0.9,
            rationale: "scripted agent",
          }),
        },
      ],
      usage: this.usage(),
    };
  }

  requestsFor(purpose: LlmRequest["purpose"]): LlmRequest[] {
    return this.requests.filter((request) => request.purpose === purpose);
  }
}

export function plausibleValue(answerType: string): unknown {
  switch (answerType) {
    case "number":
      return 1;
    case "date":
      return "2025-01-01";
    case "boolean":
      return true;
    default:
      return "x";
  }
}

export function promptText(request: LlmRequest): string {
  return request.messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : (message.content ?? [])
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("\n"),
    )
    .join("\n");
}
