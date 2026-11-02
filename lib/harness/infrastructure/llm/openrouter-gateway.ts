import type {
  ChatMessage,
  LlmGateway,
  LlmRequest,
  LlmResponse,
  ToolCall,
} from "../../application/ports";

/**
 * OpenRouter chat-completions adapter (fetch only — runs in Node and workerd).
 *
 * The supplied `openRouterRequestDefaults` (model + provider policy) are
 * spread first and never overridden; everything else in the payload is ours:
 * messages, JSON mode, tools, reasoning effort, token limits, temperature and
 * `usage.include` so the response carries the charged cost.
 */
export interface OpenRouterDefaults {
  model: string;
  provider: Record<string, unknown>;
}

export interface OpenRouterGatewayOptions {
  apiKey: string;
  defaults: OpenRouterDefaults;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  /** Optional attribution headers. */
  appName?: string;
}

interface WireMessage {
  role: string;
  content: unknown;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface CompletionResponse {
  provider?: string;
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | { type: string; text?: string }[] | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; code?: number | string };
}

class RetryableError extends Error {}

function toWire(message: ChatMessage): WireMessage {
  const wire: WireMessage = { role: message.role, content: message.content };
  if (message.toolCalls?.length) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  if (message.toolCallId) wire.tool_call_id = message.toolCallId;
  return wire;
}

export class OpenRouterGateway implements LlmGateway {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenRouterGatewayOptions) {
    this.baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  buildBody(request: LlmRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      ...this.options.defaults,
      messages: request.messages.map(toWire),
      temperature: request.temperature ?? 0,
      usage: { include: true },
    };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.json && !request.tools) body.response_format = { type: "json_object" };
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
      body.tool_choice = "auto";
    }
    if (request.reasoning) {
      // GLM 5.3 Flash on OpenRouter rejects disabled reasoning ("Reasoning is
      // mandatory"), so the lowest setting maps to the minimal effort level.
      const effort = request.reasoning === "off" ? "minimal" : request.reasoning;
      body.reasoning = { effort, exclude: true };
    }
    // Model and provider policy are fixed by the challenge: re-assert them last.
    body.model = this.options.defaults.model;
    body.provider = this.options.defaults.provider;
    return body;
  }

  async complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    const body = JSON.stringify(this.buildBody(request));
    let lastError: Error = new Error("no attempt made");
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
      try {
        return await this.attempt(body, signal);
      } catch (error) {
        lastError = error as Error;
        if (!(error instanceof RetryableError) || attempt === this.maxRetries) break;
        await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt + Math.random() * 300));
      }
    }
    throw lastError;
  }

  private async attempt(body: string, signal?: AbortSignal): Promise<LlmResponse> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": this.options.appName ?? "doc-harness",
        },
        body,
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new RetryableError(`network error: ${(error as Error).message}`);
    }
    const text = await response.text();
    if (response.status === 429 || response.status >= 500) {
      throw new RetryableError(`OpenRouter ${response.status}: ${text.slice(0, 300)}`);
    }
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${text.slice(0, 500)}`);

    let payload: CompletionResponse;
    try {
      payload = JSON.parse(text) as CompletionResponse;
    } catch {
      throw new RetryableError(`OpenRouter returned non-JSON: ${text.slice(0, 200)}`);
    }
    if (payload.error) throw new RetryableError(`OpenRouter error: ${payload.error.message ?? JSON.stringify(payload.error)}`);
    const choice = payload.choices?.[0];
    if (!choice?.message) throw new RetryableError("OpenRouter response has no message");

    const content = Array.isArray(choice.message.content)
      ? choice.message.content.map((part) => part.text ?? "").join("")
      : choice.message.content ?? "";
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? "",
      arguments: call.function?.arguments ?? "{}",
    }));
    return {
      content,
      toolCalls,
      finishReason: choice.finish_reason,
      provider: payload.provider,
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
        cachedTokens: payload.usage?.prompt_tokens_details?.cached_tokens,
        reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens,
        costUsd: typeof payload.usage?.cost === "number" ? payload.usage.cost : null,
      },
    };
  }
}
