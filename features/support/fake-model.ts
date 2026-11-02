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
  /** Per-call latency of answer calls, in call order (last value repeats). */
  answerDelaysMs: number[] = [];
  /** Second-pass (self-consistency) overrides and latency. */
  secondPassAnswers = new Map<string, ScriptedAnswer>();
  secondPassDelayMs = 0;
  /** Adjudication verdicts; unscripted adjudications fail. */
  adjudications = new Map<string, ScriptedAnswer>();

  async complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    this.requests.push(request);
    if (this.failAll) throw new Error("scripted model failure");
    if (request.purpose === "answer" && this.answerDelaysMs.length > 0) {
      const index = this.requestsFor("answer").length - 1;
      await delay(this.answerDelaysMs[Math.min(index, this.answerDelaysMs.length - 1)], signal);
    }
    if (request.purpose === "consistency" && this.secondPassDelayMs > 0) await delay(this.secondPassDelayMs, signal);
    switch (request.purpose) {
      case "triage":
        if (this.failTriage) throw new Error("scripted triage failure");
        return this.reply(JSON.stringify(this.triagePayload(request)));
      case "answer":
        return this.reply(JSON.stringify(this.answerPayload(request, this.answers)));
      case "verify": {
        const questions = (request.meta?.questions as { questionId: string }[]) ?? [];
        const verdict = this.adjudications.get(questions[0]?.questionId ?? "");
        if (!verdict) throw new Error("scripted adjudication failure");
        return this.reply(JSON.stringify(this.answerPayload(request, new Map([[questions[0].questionId, verdict]]))));
      }
      case "consistency":
        return this.reply(JSON.stringify(this.answerPayload(request, new Map([...this.answers, ...this.secondPassAnswers]))));
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
    const withRole = (role: string) => fileIds.filter((fileId) => this.triageRoles.get(fileId) === role);
    return {
      caseContext: { subject: "test subject", asOfDate: null },
      archive: withRole("archive"),
      reference: withRole("reference"),
    };
  }

  private answerPayload(request: LlmRequest, answers: Map<string, ScriptedAnswer>) {
    const questions =
      (request.meta?.questions as { questionId: string; answerType: string }[]) ?? [];
    const firstFile = ((request.meta?.dossierFileIds as string[]) ?? [])[0];
    return {
      answers: questions.map(({ questionId, answerType }) => {
        const scripted = answers.get(questionId);
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

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
}
