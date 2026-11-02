/**
 * Ports (interfaces) the application layer depends on. Adapters live in
 * `infrastructure/` (OpenRouter) or in tests (scripted fake model).
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as produced by the model. */
  arguments: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export type Purpose = "triage" | "answer" | "consistency" | "verify" | "agent" | "vision";
export type ReasoningEffort = "off" | "low" | "medium" | "high";

export interface LlmRequest {
  purpose: Purpose;
  messages: ChatMessage[];
  /** Ask for a JSON object response. */
  json?: boolean;
  tools?: ToolSpec[];
  maxTokens?: number;
  reasoning?: ReasoningEffort;
  temperature?: number;
  /** Structured context for logging and test doubles; never sent to the model. */
  meta?: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** Provider-reported charge in USD (OpenRouter `usage.cost`), when available. */
  costUsd?: number | null;
}

export interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: LlmUsage;
  finishReason?: string;
  /** Upstream provider that served the call (diagnostics only). */
  provider?: string;
}

export interface LlmGateway {
  complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export const silentLogger: Logger = { info: () => {}, warn: () => {} };
