/**
 * 本文件实现 Chat Completions 适配层：
 * - 将内部 ContextMessage 转换为厂商 wire message
 * - 构造 OpenAI-compatible 请求体
 * - 统一解析流式/非流式返回为 AdapterStreamEvent
 */
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
  tool_calls?: Array<{
    readonly id: string;
    readonly type: "function";
    readonly function: {
      readonly name: string;
      readonly arguments: string;
    };
  }>;
  name?: string;
}

interface MutableToolCallAssembly {
  id?: string;
  name?: string;
  argumentsText: string;
}

/**
 * 去掉 baseUrl 尾部多余斜杠，避免路径拼接出现 "//v1/..."。
 */
function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * 判断值是否为“纯对象”（非 null、非数组）。
 */
function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 将内部消息转为 provider 可接受的消息结构。
 * 注意：thinking 是内部消息，不应发送给模型，因此会被过滤。
 */
function toWireMessages(messages: readonly ContextMessage[]): WireMessage[] {
  const wireMessages: WireMessage[] = [];

  for (const message of messages) {
    if (message.role === "thinking") {
      // 内部思考消息只用于本地 trace/回放，不能进模型上下文。
      continue;
    }

    wireMessages.push({
      role: message.role,
      content: message.content,
      ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
      ...(message.toolCalls === undefined
        ? {}
        : {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function" as const,
              function: {
                name: toolCall.name,
                arguments: toolCall.argumentsText
              }
            }))
          }),
      ...(message.name === undefined ? {} : { name: message.name })
    });
  }

  return wireMessages;
}

/**
 * 合并策略级 extra 与调用级 extra。
 * 规则：调用级覆盖策略级（后者优先级更高）。
 */
function mergeExtra(base: JsonObject | undefined, override: JsonObject | undefined): JsonObject {
  return {
    ...(base ?? {}),
    ...(override ?? {})
  };
}

/**
 * 构建标准 Chat Completions 请求。
 */
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
    // 仅当存在工具时才注入 tools 字段，减少无用 payload。
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

/**
 * 解析非流式 JSON 响应到统一事件列表。
 */
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

/**
 * 把 tool_call_delta 分片组装成完整工具调用列表。
 * 核心：按 index 聚合，同一 index 的参数片段顺序拼接。
 */
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

/**
 * 发送请求并返回统一响应结构。
 */
export async function sendChatCompletionsRequest(input: {
  readonly adapterInput: ChatCompletionAdapterInput;
  readonly fetchFn: FetchLike;
  readonly clock: RuntimeClock;
  readonly onStreamEvent?: (event: AdapterStreamEvent) => void | Promise<void>;
}): Promise<ChatCompletionAdapterResponse> {
  const startedAt = input.clock.now();
  const request = buildChatCompletionsRequest(input.adapterInput);
  const response = await input.fetchFn(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  let events: readonly AdapterStreamEvent[];
  let firstTokenAt: number | undefined;

  /**
   * 统一处理 adapter 事件的实时回调。
   *
   * 这里放在 adapter 层而不是 CLI 层，是因为 server SSE、CLI 打字效果、未来 UI 都应复用同一套
   * token 事件，而不是各自重新解析厂商 SSE 文本。
   */
  const publishAdapterEvent = async (event: AdapterStreamEvent): Promise<void> => {
    if (
      firstTokenAt === undefined &&
      (event.type === "message_delta" || event.type === "thinking_delta" || event.type === "tool_call_delta")
    ) {
      // 首 token 延迟应该在事件刚解析出来时记录，而不是等完整响应读完后再记录。
      firstTokenAt = input.clock.now();
    }

    await input.onStreamEvent?.(event);
  };

  if (input.adapterInput.stream) {
    // 流式模式：从 SSE 逐块解析事件。
    events = await readSseStream(response, publishAdapterEvent);
  } else {
    // 非流式模式：一次性 JSON 解析并映射为事件。
    const payload = (await response.json()) as JsonObject;
    events = parseNonStreamResponse(payload);

    for (const event of events) {
      // 非流式也走同一套回调，方便测试和上层统一处理。
      await publishAdapterEvent(event);
    }
  }

  const completedAt = input.clock.now();

  return {
    request,
    status: response.status,
    ...(response.headers.get("x-request-id") === null ? {} : { requestId: response.headers.get("x-request-id") as string }),
    ...(firstTokenAt === undefined ? {} : { firstTokenMs: firstTokenAt - startedAt }),
    totalMs: completedAt - startedAt,
    events
  };
}
