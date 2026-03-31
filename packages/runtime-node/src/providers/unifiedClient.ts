/**
 * 本文件作用：
 * - 统一封装 Provider 调用（OpenAI Chat / OpenAI Responses / Gemini OpenAI-compatible Chat）。
 * - 不依赖任何 SDK，直接使用 fetch + REST/SSE 协议。
 *
 * 教学说明：
 * - 这里把“统一语义”和“具体厂商差异”分开处理。
 * - 统一语义由 UnifiedModelRequest / UnifiedModelFinalResult 表达；
 *   厂商差异通过请求映射与流式事件映射来处理。
 */

import { randomUUID } from "node:crypto";
import type {
  JsonObject,
  JsonValue,
  ProviderErrorShape,
  UnifiedModelTool,
  UnifiedMessage,
  UnifiedModelFinalResult,
  UnifiedModelRequest,
  UnifiedModelStreamEvent
} from "../types/index.js";
import { getProviderCapabilities, validateProviderRequestCapabilities } from "./capabilities.js";
import { parseSse } from "./sse.js";

function safeJsonParse(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(req: UnifiedModelRequest): string {
  if (req.vendor === "mock") return "mock://local";
  if (!req.baseURL) throw new Error("缺少 baseURL");
  return req.baseURL.replace(/\/+$/, "");
}

function requireApiKey(req: UnifiedModelRequest): string {
  if (req.vendor === "mock") return "mock";
  if (!req.apiKey) throw new Error("缺少 apiKey");
  return req.apiKey;
}

function toChatMessages(
  messages: UnifiedMessage[],
  vendor: UnifiedModelRequest["vendor"]
): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    // 部分 OpenAI-compatible 提供商不接受 developer role，做兼容降级。
    const role = msg.role === "developer" && vendor !== "openai" ? "system" : msg.role;
    const base: Record<string, unknown> = {
      role,
      content: msg.content
    };
    if (msg.name) base.name = msg.name;
    if (msg.toolCallId) base.tool_call_id = msg.toolCallId;
    return base;
  });
}

function extractTextFromResponsesOutput(data: JsonObject): string {
  const output = Array.isArray(data.output) ? (data.output as JsonValue[]) : [];
  const textParts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const typedItem = item as Record<string, unknown>;
    // 常见模式：{ type: "message", content: [{ type: "output_text", text: "..." }] }
    const content = typedItem.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== "object" || Array.isArray(c)) continue;
        const cc = c as Record<string, unknown>;
        if (cc.type === "output_text" && typeof cc.text === "string") {
          textParts.push(cc.text);
        }
      }
    }
  }
  return textParts.join("");
}

function extractToolCallsFromResponsesOutput(data: JsonObject): UnifiedModelFinalResult["toolCalls"] {
  const output = Array.isArray(data.output) ? (data.output as JsonValue[]) : [];
  const calls: UnifiedModelFinalResult["toolCalls"] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const typedItem = item as Record<string, unknown>;
    if (typedItem.type === "function_call") {
      const name = typeof typedItem.name === "string" ? typedItem.name : "unknown_function";
      const callId =
        typeof typedItem.call_id === "string"
          ? typedItem.call_id
          : `toolcall_${randomUUID().replace(/-/g, "")}`;
      let argsObj: JsonObject = {};
      const rawArgs = typedItem.arguments;
      if (typeof rawArgs === "string") {
        const parsed = safeJsonParse(rawArgs);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          argsObj = parsed as JsonObject;
        }
      } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
        argsObj = rawArgs as JsonObject;
      }
      calls.push({
        toolCallId: callId,
        toolName: name,
        argumentsJson: argsObj
      });
    }
  }
  return calls;
}

function getToolName(tool: UnifiedModelTool): string {
  if (tool.type === "function") return tool.function.name;
  return tool.custom.name;
}

interface MockRule {
  match: string;
  text?: string;
  toolCalls?: Array<{
    toolCallId?: string;
    toolName: string;
    argumentsJson?: JsonObject;
  }>;
}

function resolveMockRule(req: UnifiedModelRequest): MockRule | null {
  const extra = (req.vendorExtra ?? {}) as JsonObject;
  const rules = Array.isArray(extra.mockRules) ? extra.mockRules : [];
  const joinedMessages = (req.messages ?? []).map((msg) => msg.content).join("\n");
  for (const rawRule of rules) {
    if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) continue;
    const rule = rawRule as Record<string, unknown>;
    const match = typeof rule.match === "string" ? rule.match : "";
    if (!match || !joinedMessages.includes(match)) continue;
    const toolCalls = Array.isArray(rule.toolCalls)
      ? rule.toolCalls
          .filter((item) => item && typeof item === "object" && !Array.isArray(item))
          .map((item) => {
            const typed = item as Record<string, unknown>;
            return {
              toolCallId: typeof typed.toolCallId === "string" ? typed.toolCallId : undefined,
              toolName: typeof typed.toolName === "string" ? typed.toolName : "unknown_function",
              argumentsJson:
                typed.argumentsJson && typeof typed.argumentsJson === "object" && !Array.isArray(typed.argumentsJson)
                  ? (typed.argumentsJson as JsonObject)
                  : {}
            };
          })
      : undefined;
    return {
      match,
      text: typeof rule.text === "string" ? rule.text : undefined,
      toolCalls
    };
  }
  return null;
}

function buildMockResult(req: UnifiedModelRequest): UnifiedModelFinalResult {
  const matchedRule = resolveMockRule(req);
  const text = [
    matchedRule?.text ?? "",
    `【Mock ${req.apiMode} 响应】`,
    `model=${req.model}`,
    `messages=${req.messages?.length ?? 0}`,
    req.tools?.length ? `tools=${req.tools.map((t) => getToolName(t)).join(", ")}` : "tools=none",
    "这是用于调试框架链路的模拟输出。"
  ]
    .filter(Boolean)
    .join("\n");
  return {
    provider: "mock",
    apiMode: req.apiMode,
    model: req.model,
    text,
    toolCalls:
      matchedRule?.toolCalls?.map((item) => ({
        toolCallId: item.toolCallId ?? `toolcall_${randomUUID().replace(/-/g, "")}`,
        toolName: item.toolName,
        argumentsJson: item.argumentsJson ?? {}
      })) ?? [],
    reasoningSummary: req.reasoningConfig?.effort ? `mock reasoning effort=${req.reasoningConfig.effort}` : undefined,
    thoughts: req.reasoningConfig?.includeThoughts ? ["这是 mock 的 thought 示例。"] : undefined,
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

export class UnifiedProviderClient {
  /**
   * 非流式调用（一次性返回最终结果）。
   */
  async invoke(req: UnifiedModelRequest): Promise<UnifiedModelFinalResult> {
    const capabilityError = validateProviderRequestCapabilities(req);
    if (capabilityError) {
      throw new Error(`[${capabilityError.code}] ${capabilityError.message}`);
    }

    if (req.vendor === "mock") {
      return buildMockResult(req);
    }

    if (req.apiMode === "chat_completions") {
      return this.invokeChatCompletions(req);
    }
    return this.invokeResponses(req);
  }

  /**
   * 流式调用（统一事件流）。
   * 注意：
   * - 这里返回的是“归一化后的事件”，便于调试器直接消费。
   */
  async *stream(req: UnifiedModelRequest): AsyncGenerator<UnifiedModelStreamEvent> {
    const capabilityError = validateProviderRequestCapabilities(req);
    if (capabilityError) {
      yield {
        type: "raw_event",
        provider: req.vendor,
        apiMode: req.apiMode,
        event: capabilityError as unknown as JsonValue
      };
      throw new Error(`[${capabilityError.code}] ${capabilityError.message}`);
    }

    if (req.vendor === "mock") {
      const mock = buildMockResult(req);
      yield {
        type: "response_started",
        provider: "mock",
        requestId: `mock_${randomUUID().replace(/-/g, "")}`,
        model: req.model
      };
      if (mock.text) {
        yield {
          type: "text_delta",
          delta: mock.text,
          provider: "mock",
          apiMode: req.apiMode
        };
      }
      for (const toolCall of mock.toolCalls) {
        yield {
          type: "tool_call_request",
          provider: "mock",
          apiMode: req.apiMode,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          argumentsDelta: JSON.stringify(toolCall.argumentsJson ?? {})
        };
      }
      if (mock.thoughts?.length) {
        yield {
          type: "reasoning",
          provider: "mock",
          apiMode: req.apiMode,
          reasoningSummary: mock.reasoningSummary,
          thoughts: mock.thoughts
        };
      }
      yield {
        type: "response_completed",
        provider: "mock",
        apiMode: req.apiMode,
        finishReason: "stop",
        usage: mock.usage
      };
      return;
    }

    if (req.apiMode === "chat_completions") {
      yield* this.streamChatCompletions(req);
      return;
    }
    yield* this.streamResponses(req);
  }

  private async invokeChatCompletions(req: UnifiedModelRequest): Promise<UnifiedModelFinalResult> {
    const baseURL = normalizeBaseUrl(req);
    const apiKey = requireApiKey(req);
    const endpoint = `${baseURL}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toChatMessages(req.messages ?? [], req.vendor),
      stream: false
    };

    if (typeof req.temperature === "number") body.temperature = req.temperature;
    if (typeof req.topP === "number") body.top_p = req.topP;
    if (req.tools) body.tools = req.tools;
    if (req.toolChoice) body.tool_choice = req.toolChoice;
    if (req.responseFormat) body.response_format = req.responseFormat;
    if (req.reasoningConfig?.effort) {
      body.reasoning_effort = req.reasoningConfig.effort;
    }

    /**
     * Gemini 差异参数：
     * - includeThoughts 通过 extra_body.google.thinking_config 传递（官方兼容文档）
     */
    if (req.vendor === "gemini_openai_compat" && req.reasoningConfig?.includeThoughts) {
      const existing = (req.vendorExtra ?? {}) as JsonObject;
      body.extra_body = {
        ...existing,
        google: {
          thinking_config: {
            thinking_level: req.reasoningConfig.effort ?? "low",
            include_thoughts: true
          }
        }
      };
    } else if (req.vendorExtra) {
      body.extra_body = req.vendorExtra;
    }

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`chat/completions 调用失败 (${resp.status}): ${text.slice(0, 500)}`);
    }
    const data = (await resp.json()) as JsonObject;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = (choices[0] ?? {}) as Record<string, unknown>;
    const message = ((first.message as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
    const content = typeof message.content === "string" ? message.content : "";

    const toolCallsRaw = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls = toolCallsRaw.map((item) => {
      const obj = item as Record<string, unknown>;
      const fn = (obj.function ?? {}) as Record<string, unknown>;
      const parsedArgs =
        typeof fn.arguments === "string"
          ? (safeJsonParse(fn.arguments) as JsonObject | undefined) ?? {}
          : ((fn.arguments as JsonObject | undefined) ?? {});
      return {
        toolCallId:
          typeof obj.id === "string" ? obj.id : `toolcall_${randomUUID().replace(/-/g, "")}`,
        toolName: typeof fn.name === "string" ? fn.name : "unknown_function",
        argumentsJson: parsedArgs
      };
    });

    // Gemini include_thoughts 时，兼容文档给出 choices[i].thoughts。
    const thoughts =
      Array.isArray(first.thoughts)
        ? (first.thoughts as Array<Record<string, unknown>>)
            .map((t) => (typeof t.thought === "string" ? t.thought : ""))
            .filter(Boolean)
        : undefined;

    return {
      provider: req.vendor,
      apiMode: "chat_completions",
      model: String(data.model ?? req.model),
      text: content,
      toolCalls,
      reasoningSummary: thoughts?.join("\n"),
      thoughts,
      usage: (data.usage as JsonObject | undefined) ?? undefined,
      raw: data
    };
  }

  private async invokeResponses(req: UnifiedModelRequest): Promise<UnifiedModelFinalResult> {
    const baseURL = normalizeBaseUrl(req);
    const apiKey = requireApiKey(req);
    const endpoint = `${baseURL}/responses`;
    const body: Record<string, unknown> = {
      model: req.model,
      stream: false
    };

    /**
     * Responses API 输入格式比 chat 更灵活。
     * - 首版优先支持 messages -> input 的常见映射。
     */
    if (req.responseInput !== undefined) {
      body.input = req.responseInput;
    } else {
      body.input = (req.messages ?? []).map((m) => ({
        role: m.role,
        content: [{ type: "input_text", text: m.content }]
      }));
    }

    if (typeof req.temperature === "number") body.temperature = req.temperature;
    if (typeof req.topP === "number") body.top_p = req.topP;
    if (typeof req.maxOutputTokens === "number") body.max_output_tokens = req.maxOutputTokens;
    if (req.tools) body.tools = req.tools;
    if (req.toolChoice) body.tool_choice = req.toolChoice;
    if (req.responseFormat) body.response_format = req.responseFormat;
    if (req.reasoningConfig?.effort) {
      body.reasoning = {
        effort: req.reasoningConfig.effort
      };
    }
    if (req.vendorExtra) {
      Object.assign(body, req.vendorExtra);
    }

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`responses 调用失败 (${resp.status}): ${text.slice(0, 500)}`);
    }
    const data = (await resp.json()) as JsonObject;
    const text = typeof data.output_text === "string" ? (data.output_text as string) : extractTextFromResponsesOutput(data);
    const toolCalls = extractToolCallsFromResponsesOutput(data);

    let reasoningSummary: string | undefined;
    const thoughts: string[] = [];
    const output = Array.isArray(data.output) ? data.output : [];
    for (const item of output as JsonValue[]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      if (obj.type === "reasoning") {
        if (typeof obj.summary === "string") {
          thoughts.push(obj.summary);
        }
      }
    }
    if (thoughts.length > 0) reasoningSummary = thoughts.join("\n");

    return {
      provider: req.vendor,
      apiMode: "responses",
      model: String(data.model ?? req.model),
      text,
      toolCalls,
      reasoningSummary,
      thoughts: thoughts.length > 0 ? thoughts : undefined,
      usage: (data.usage as JsonObject | undefined) ?? undefined,
      raw: data
    };
  }

  private async *streamChatCompletions(
    req: UnifiedModelRequest
  ): AsyncGenerator<UnifiedModelStreamEvent> {
    const baseURL = normalizeBaseUrl(req);
    const apiKey = requireApiKey(req);
    const endpoint = `${baseURL}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toChatMessages(req.messages ?? [], req.vendor),
      stream: true
    };
    if (typeof req.temperature === "number") body.temperature = req.temperature;
    if (typeof req.topP === "number") body.top_p = req.topP;
    if (req.tools) body.tools = req.tools;
    if (req.toolChoice) body.tool_choice = req.toolChoice;
    if (req.responseFormat) body.response_format = req.responseFormat;
    if (req.reasoningConfig?.effort) body.reasoning_effort = req.reasoningConfig.effort;
    if (req.vendor === "gemini_openai_compat" && req.reasoningConfig?.includeThoughts) {
      body.extra_body = {
        ...(req.vendorExtra ?? {}),
        google: {
          thinking_config: {
            thinking_level: req.reasoningConfig.effort ?? "low",
            include_thoughts: true
          }
        }
      };
    } else if (req.vendorExtra) {
      body.extra_body = req.vendorExtra;
    }

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`chat/completions stream 调用失败 (${resp.status}): ${text.slice(0, 500)}`);
    }

    yield {
      type: "response_started",
      provider: req.vendor,
      model: req.model
    };

    for await (const frame of parseSse(resp)) {
      if (frame.data === "[DONE]") {
        yield {
          type: "response_completed",
          provider: req.vendor,
          apiMode: "chat_completions",
          finishReason: "stop"
        };
        break;
      }

      const parsed = safeJsonParse(frame.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        yield {
          type: "raw_event",
          provider: req.vendor,
          apiMode: "chat_completions",
          event: frame.data
        };
        continue;
      }
      const data = parsed as Record<string, unknown>;
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const first = (choices[0] ?? {}) as Record<string, unknown>;
      const delta = ((first.delta as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

      if (typeof delta.content === "string" && delta.content.length > 0) {
        yield {
          type: "text_delta",
          delta: delta.content,
          provider: req.vendor,
          apiMode: "chat_completions"
        };
      }

      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const rawCall of toolCalls) {
        const tc = rawCall as Record<string, unknown>;
        const fn = ((tc.function as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
        yield {
          type: "tool_call_request",
          provider: req.vendor,
          apiMode: "chat_completions",
          toolCallId:
            typeof tc.id === "string" ? tc.id : `toolcall_${randomUUID().replace(/-/g, "")}`,
          toolName: typeof fn.name === "string" ? fn.name : "unknown_function",
          argumentsDelta: typeof fn.arguments === "string" ? fn.arguments : undefined
        };
      }

      // Gemini 兼容层有时在非标准字段中返回 thoughts，先做宽松探测。
      const thoughtsRaw = Array.isArray(first.thoughts) ? first.thoughts : [];
      if (thoughtsRaw.length > 0) {
        const thoughts = thoughtsRaw
          .map((t) =>
            t && typeof t === "object" && !Array.isArray(t) && typeof (t as Record<string, unknown>).thought === "string"
              ? String((t as Record<string, unknown>).thought)
              : ""
          )
          .filter(Boolean);
        if (thoughts.length > 0) {
          yield {
            type: "reasoning",
            provider: req.vendor,
            apiMode: "chat_completions",
            thoughts,
            reasoningSummary: thoughts.join("\n")
          };
        }
      }
    }
  }

  private async *streamResponses(req: UnifiedModelRequest): AsyncGenerator<UnifiedModelStreamEvent> {
    const baseURL = normalizeBaseUrl(req);
    const apiKey = requireApiKey(req);
    const endpoint = `${baseURL}/responses`;
    const body: Record<string, unknown> = {
      model: req.model,
      stream: true
    };
    body.input =
      req.responseInput !== undefined
        ? req.responseInput
        : (req.messages ?? []).map((m) => ({
            role: m.role,
            content: [{ type: "input_text", text: m.content }]
          }));
    if (typeof req.temperature === "number") body.temperature = req.temperature;
    if (typeof req.topP === "number") body.top_p = req.topP;
    if (typeof req.maxOutputTokens === "number") body.max_output_tokens = req.maxOutputTokens;
    if (req.tools) body.tools = req.tools;
    if (req.toolChoice) body.tool_choice = req.toolChoice;
    if (req.responseFormat) body.response_format = req.responseFormat;
    if (req.reasoningConfig?.effort) body.reasoning = { effort: req.reasoningConfig.effort };
    if (req.vendorExtra) Object.assign(body, req.vendorExtra);

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`responses stream 调用失败 (${resp.status}): ${text.slice(0, 500)}`);
    }

    yield {
      type: "response_started",
      provider: req.vendor,
      apiMode: "responses",
      model: req.model
    };

    for await (const frame of parseSse(resp)) {
      if (frame.data === "[DONE]") {
        yield {
          type: "response_completed",
          provider: req.vendor,
          apiMode: "responses",
          finishReason: "stop"
        };
        break;
      }

      const parsed = safeJsonParse(frame.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        yield {
          type: "raw_event",
          provider: req.vendor,
          apiMode: "responses",
          event: frame.data
        };
        continue;
      }
      const data = parsed as Record<string, unknown>;
      const eventType = typeof data.type === "string" ? data.type : frame.event;

      // OpenAI Responses 常见流式事件：output_text.delta / response.completed / function_call 等。
      if (eventType?.includes("output_text") && typeof data.delta === "string") {
        yield {
          type: "text_delta",
          delta: data.delta,
          provider: req.vendor,
          apiMode: "responses"
        };
        continue;
      }

      if (eventType?.includes("function_call")) {
        yield {
          type: "tool_call_request",
          provider: req.vendor,
          apiMode: "responses",
          toolCallId:
            typeof data.call_id === "string"
              ? data.call_id
              : `toolcall_${randomUUID().replace(/-/g, "")}`,
          toolName: typeof data.name === "string" ? data.name : "unknown_function",
          argumentsDelta: typeof data.arguments === "string" ? data.arguments : undefined
        };
        continue;
      }

      if (eventType?.includes("reasoning")) {
        const summary =
          typeof data.summary === "string"
            ? data.summary
            : typeof data.text === "string"
              ? data.text
              : undefined;
        yield {
          type: "reasoning",
          provider: req.vendor,
          apiMode: "responses",
          reasoningSummary: summary
        };
        continue;
      }

      if (eventType?.includes("completed")) {
        yield {
          type: "response_completed",
          provider: req.vendor,
          apiMode: "responses",
          finishReason: "completed",
          usage: (data.usage as JsonObject | undefined) ?? undefined
        };
        continue;
      }

      yield {
        type: "raw_event",
        provider: req.vendor,
        apiMode: "responses",
        event: parsed
      };
    }
  }
}

/**
 * 工具调用循环（统一层辅助函数）：
 * - 运行时可以使用此函数实现“模型 -> tool call -> 执行工具 -> 再喂回模型”的循环。
 * - 这里仅提供协议转换辅助，不直接绑定 ToolRuntime。
 */
export function appendToolResultsToMessages(
  messages: UnifiedMessage[],
  toolResults: Array<{ toolCallId: string; toolName: string; outputText: string }>
): UnifiedMessage[] {
  const next = [...messages];
  for (const item of toolResults) {
    next.push({
      role: "tool",
      name: item.toolName,
      toolCallId: item.toolCallId,
      content: item.outputText
    });
  }
  return next;
}
