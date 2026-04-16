import type {
  AdapterStreamEvent,
  ChatCompletionAdapterInput,
  ChatCompletionAdapterResponse,
  FetchLike,
  ObservableHttpRequest
} from "../types/api.js";
import type { JsonObject, JsonValue, RuntimeClock } from "../types/common.js";
import type { ContextContent, ContextMessage } from "../types/messages.js";
import { readSseStream } from "./stream.js";

interface WireMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: ContextContent;
  tool_call_id?: string;
  name?: string;
}

interface MutableToolCallAssembly {
  id?: string;
  name?: string;
  argumentsText: string;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toWireMessages(messages: readonly ContextMessage[]): WireMessage[] {
  const wireMessages: WireMessage[] = [];

  for (const message of messages) {
    if (message.role === "thinking") {
      continue;
    }

    wireMessages.push({
      role: message.role,
      content: message.content,
      ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
      ...(message.name === undefined ? {} : { name: message.name })
    });
  }

  return wireMessages;
}

function mergeExtra(base: JsonObject | undefined, override: JsonObject | undefined): JsonObject {
  return {
    ...(base ?? {}),
    ...(override ?? {})
  };
}

export function buildChatCompletionsRequest(input: ChatCompletionAdapterInput): ObservableHttpRequest {
  const extra = mergeExtra(input.strategy.extra, input.extra);
  const body: Record<string, JsonValue> = {
    model: input.strategy.model,
    messages: toWireMessages(input.messages) as unknown as JsonValue,
    stream: input.stream,
    ...(input.stream ? { stream_options: { include_usage: true } } : {}),
    ...extra
  };

  if (input.tools.length > 0) {
    body.tools = input.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    })) as unknown as JsonValue;
  }

  return {
    url: `${trimSlash(input.strategy.baseUrl)}/v1/chat/completions`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.strategy.apiKey}`
    },
    body
  };
}

function parseNonStreamResponse(payload: JsonObject): AdapterStreamEvent[] {
  const choices = payload.choices;

  if (!Array.isArray(choices)) {
    return [];
  }

  const events: AdapterStreamEvent[] = [];

  for (const choice of choices) {
    if (!isPlainObject(choice)) {
      continue;
    }

    const message = choice.message;

    if (!isPlainObject(message)) {
      continue;
    }

    if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) {
      events.push({ type: "thinking_delta", delta: message.reasoning_content });
    }

    if (typeof message.content === "string" && message.content.length > 0) {
      events.push({ type: "message_delta", delta: message.content });
    }
  }

  events.push({ type: "done" });
  return events;
}

export function assembleToolCalls(events: readonly AdapterStreamEvent[]) {
  const calls = new Map<number, MutableToolCallAssembly>();

  for (const event of events) {
    if (event.type !== "tool_call_delta") {
      continue;
    }

    const current = calls.get(event.index) ?? { argumentsText: "" };

    if (event.id !== undefined) {
      current.id = event.id;
    }

    if (event.name !== undefined) {
      current.name = event.name;
    }

    if (event.argumentsDelta !== undefined) {
      current.argumentsText += event.argumentsDelta;
    }

    calls.set(event.index, current);
  }

  return [...calls.entries()].map(([index, value]) => ({
    id: value.id ?? `tool_call_${index}`,
    name: value.name ?? "unknown_tool",
    argumentsText: value.argumentsText
  }));
}

export async function sendChatCompletionsRequest(input: {
  readonly adapterInput: ChatCompletionAdapterInput;
  readonly fetchFn: FetchLike;
  readonly clock: RuntimeClock;
}): Promise<ChatCompletionAdapterResponse> {
  const startedAt = input.clock.now();
  const request = buildChatCompletionsRequest(input.adapterInput);
  const response = await input.fetchFn(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  let events: readonly AdapterStreamEvent[];

  if (input.adapterInput.stream) {
    events = await readSseStream(response);
  } else {
    const payload = (await response.json()) as JsonObject;
    events = parseNonStreamResponse(payload);
  }

  const firstEvent = events.find((event) => event.type === "message_delta" || event.type === "thinking_delta");
  const completedAt = input.clock.now();

  return {
    request,
    status: response.status,
    ...(response.headers.get("x-request-id") === null ? {} : { requestId: response.headers.get("x-request-id") as string }),
    ...(firstEvent === undefined ? {} : { firstTokenMs: completedAt - startedAt }),
    totalMs: completedAt - startedAt,
    events
  };
}
