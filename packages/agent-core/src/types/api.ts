import type { JsonObject, SimpAgentId } from "./common.js";
import type { ContextMessage } from "./messages.js";
import type { ToolDefinition } from "./tools.js";

export type ApiProviderKind = "openai-chat-completions" | "deepseek-chat-completions";

export interface ProviderStrategy {
  readonly id: SimpAgentId;
  readonly name: string;
  readonly provider: ApiProviderKind;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly tags?: readonly string[];
  readonly timeoutMs?: number;
  readonly extra?: JsonObject;
}

export interface ChatCompletionAdapterInput {
  readonly strategy: ProviderStrategy;
  readonly messages: readonly ContextMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly stream: boolean;
  readonly extra?: JsonObject;
}

export interface ObservableHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: JsonObject;
}

export type AdapterStreamEvent =
  | {
      readonly type: "message_delta";
      readonly delta: string;
    }
  | {
      readonly type: "thinking_delta";
      readonly delta: string;
    }
  | {
      readonly type: "tool_call_delta";
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsDelta?: string;
    }
  | {
      readonly type: "done";
    };

export interface AdapterUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface ChatCompletionAdapterResponse {
  readonly request: ObservableHttpRequest;
  readonly status: number;
  readonly requestId?: string;
  readonly firstTokenMs?: number;
  readonly totalMs: number;
  readonly events: readonly AdapterStreamEvent[];
  readonly usage?: AdapterUsage;
}

export interface FetchLike {
  (input: string, init: RequestInit): Promise<Response>;
}

