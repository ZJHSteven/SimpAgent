/**
 * 本文件作用：
 * - 定义“内层暴露适配层”的统一接口与策略选择器。
 * - 把 CanonicalToolSpec 转换为不同模型 API 可接受的请求结构。
 * - 把模型输出（function call / structured output / prompt 协议）统一解析回 CanonicalToolCallIntent。
 *
 * 教学说明：
 * - 三层架构里，本文件是“第三层：模型暴露适配层”；
 * - 它不执行工具，只负责“怎么暴露给模型”和“怎么把模型信号还原成统一调用意图”。
 */

import { randomUUID } from "node:crypto";
import type {
  CanonicalToolCallIntent,
  CanonicalToolSpec,
  JsonObject,
  JsonValue,
  ProviderCapabilities,
  ProviderVendor,
  ToolExposureAdapterKind,
  ToolProtocolProfile,
  ToolExposurePlan,
  UnifiedMessage,
  UnifiedModelFinalResult,
  UnifiedModelRequest
} from "../../types/index.js";

export interface ToolExposureBuildRequest {
  provider: {
    vendor: ProviderVendor;
    apiMode: UnifiedModelRequest["apiMode"];
    toolProtocolProfile?: ToolProtocolProfile;
  };
  modelCaps?: Partial<ProviderCapabilities>;
  override?: {
    preferredAdapter?: ToolExposureAdapterKind;
    fallbackAdapters?: ToolExposureAdapterKind[];
  };
}

export interface BuildModelRequestArgs {
  baseRequest: UnifiedModelRequest;
  exposurePlan: ToolExposurePlan;
  canonicalTools: CanonicalToolSpec[];
}

/**
 * 内层暴露适配器接口（可替换插件）。
 */
export interface ToolExposureAdapter {
  readonly kind: ToolExposureAdapterKind;
  buildToolExposure(req: ToolExposureBuildRequest, canonicalTools: CanonicalToolSpec[]): ToolExposurePlan;
  buildModelRequest(args: BuildModelRequestArgs): UnifiedModelRequest;
  parseModelToolSignal(args: {
    finalResult?: UnifiedModelFinalResult;
    raw?: unknown;
    canonicalTools: CanonicalToolSpec[];
  }): CanonicalToolCallIntent[];
}

function newPlanId(): string {
  return `texp_${randomUUID().replace(/-/g, "")}`;
}

function newToolCallId(): string {
  return `toolcall_${randomUUID().replace(/-/g, "")}`;
}

function mapTools(planKind: ToolExposureAdapterKind, tools: CanonicalToolSpec[]): ToolExposurePlan["exposedTools"] {
  return tools
    .filter((tool) => tool.enabled && tool.exposure.exposeByDefault)
    .map((tool) => ({
      canonicalToolId: tool.id,
      toolName: tool.name,
      exposureLevel: tool.exposure.exposureLevel,
      exposedAs:
        planKind === "responses_native"
          ? "responses_native"
          : planKind === "chat_function"
            ? "function"
            : planKind === "chat_custom"
              ? "custom"
              : planKind === "structured_output_tool_call"
                ? "structured_output"
                : "prompt_protocol",
      schemaIncluded: tool.exposure.exposureLevel === "full_schema"
    }));
}

function safeJsonParse(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function toolDescByLevel(tool: CanonicalToolSpec): string {
  const level = tool.exposure.exposureLevel;
  if (level === "name_only") return tool.name;
  if (level === "summary") return tool.summary ?? tool.description;
  return tool.description;
}

function buildFunctionTools(tools: CanonicalToolSpec[]): NonNullable<UnifiedModelRequest["tools"]> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: toolDescByLevel(tool),
      parameters: tool.exposure.exposureLevel === "name_only" ? { type: "object", properties: {} } : tool.inputSchema
    }
  }));
}

function buildCustomTools(tools: CanonicalToolSpec[]): NonNullable<UnifiedModelRequest["tools"]> {
  return tools.map((tool) => ({
    type: "custom" as const,
    custom: {
      name: tool.name,
      description: toolDescByLevel(tool),
      format:
        tool.exposure.exposureLevel === "name_only"
          ? { type: "text" as const }
          : {
              type: "json_schema" as const,
              json_schema: {
                name: `${tool.name}_params`,
                schema: tool.inputSchema,
                strict: false
              }
            }
    }
  }));
}

function appendDeveloperMessage(messages: UnifiedMessage[] | undefined, content: string): UnifiedMessage[] {
  const list = [...(messages ?? [])];
  list.push({
    role: "developer",
    content
  });
  return list;
}

interface ParsedSignalItem {
  toolName: string;
  args?: JsonObject;
  freeformText?: string;
  rawSignal?: JsonValue;
}

function normalizeSignalItem(raw: JsonValue | undefined): ParsedSignalItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const toolName = typeof obj.name === "string" ? obj.name : typeof obj.tool === "string" ? obj.tool : null;
  if (!toolName) return null;
  let args: JsonObject | undefined;
  if (obj.arguments && typeof obj.arguments === "object" && !Array.isArray(obj.arguments)) {
    args = obj.arguments as JsonObject;
  } else if (obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)) {
    args = obj.args as JsonObject;
  }
  const freeformText = typeof obj.input === "string" ? obj.input : undefined;
  return {
    toolName,
    args,
    freeformText,
    rawSignal: raw
  };
}

function extractJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates = new Set<string>();
  if (trimmed) candidates.add(trimmed);

  // 提取 ```json ...``` 或 ```tool_call ...``` 代码块。
  const fenceRegex = /```(?:json|tool_call)?\s*([\s\S]*?)```/gi;
  for (const match of trimmed.matchAll(fenceRegex)) {
    const body = match[1]?.trim();
    if (body) candidates.add(body);
  }

  // 提取 XML 风格标签包裹的 JSON：<tool_call>...</tool_call>
  const tagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  for (const match of trimmed.matchAll(tagRegex)) {
    const body = match[1]?.trim();
    if (body) candidates.add(body);
  }

  return [...candidates];
}

function parseTextToolSignals(text: string): ParsedSignalItem[] {
  const result: ParsedSignalItem[] = [];
  for (const candidate of extractJsonCandidates(text)) {
    const parsed = safeJsonParse(candidate);
    if (!parsed) continue;

    // 1) { tool_calls: [...] }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const toolCalls = Array.isArray(obj.tool_calls) ? (obj.tool_calls as JsonValue[]) : [];
      for (const tc of toolCalls) {
        const item = normalizeSignalItem(tc);
        if (item) result.push(item);
      }
      const single = normalizeSignalItem(parsed);
      if (single) result.push(single);
      continue;
    }

    // 2) [{name, arguments}, ...]
    if (Array.isArray(parsed)) {
      for (const itemRaw of parsed) {
        const item = normalizeSignalItem(itemRaw);
        if (item) result.push(item);
      }
      continue;
    }
  }

  // 3) 行协议：TOOL_CALL {"name":"...","arguments":{...}}
  const lineRegex = /TOOL_CALL\s+(\{[\s\S]*?\})(?:\n|$)/g;
  for (const match of text.matchAll(lineRegex)) {
    const parsed = safeJsonParse(match[1]);
    const item = normalizeSignalItem(parsed);
    if (item) result.push(item);
  }

  return result;
}

function parseFunctionToolCalls(args: {
  finalResult?: UnifiedModelFinalResult;
  adapterKind: ToolExposureAdapterKind;
  canonicalTools: CanonicalToolSpec[];
}): CanonicalToolCallIntent[] {
  const finalResult = args.finalResult;
  if (!finalResult) return [];
  const nameToTool = new Map(args.canonicalTools.map((tool) => [tool.name, tool] as const));
  const intents: CanonicalToolCallIntent[] = [];
  for (const call of finalResult.toolCalls) {
    const tool = nameToTool.get(call.toolName);
    if (!tool) continue;
    intents.push({
      toolCallId: call.toolCallId,
      canonicalToolId: tool.id,
      toolName: tool.name,
      adapterKind: args.adapterKind,
      payloadMode: "json_args",
      args: call.argumentsJson
    });
  }
  return intents;
}

function parseTextSignalsToIntents(args: {
  text: string;
  adapterKind: ToolExposureAdapterKind;
  canonicalTools: CanonicalToolSpec[];
}): CanonicalToolCallIntent[] {
  const byName = new Map(args.canonicalTools.map((tool) => [tool.name, tool] as const));
  const parsed = parseTextToolSignals(args.text);
  const intents: CanonicalToolCallIntent[] = [];
  for (const item of parsed) {
    const tool = byName.get(item.toolName);
    if (!tool) continue;
    intents.push({
      toolCallId: newToolCallId(),
      canonicalToolId: tool.id,
      toolName: tool.name,
      adapterKind: args.adapterKind,
      payloadMode: item.args ? "json_args" : "freeform_text",
      args: item.args,
      freeformText: item.freeformText,
      rawSignal: item.rawSignal
    });
  }
  return intents;
}

abstract class BaseExposureAdapter implements ToolExposureAdapter {
  constructor(public readonly kind: ToolExposureAdapterKind) {}

  buildToolExposure(req: ToolExposureBuildRequest, canonicalTools: CanonicalToolSpec[]): ToolExposurePlan {
    const preferred = req.override?.preferredAdapter ?? this.kind;
    const fallbackChain = req.override?.fallbackAdapters ?? [];
    return {
      planId: newPlanId(),
      adapterKind: preferred,
      exposedTools: mapTools(preferred, canonicalTools),
      fallbackChain,
      metadata: {
        provider: req.provider.vendor,
        apiMode: req.provider.apiMode,
        toolProtocolProfile: req.provider.toolProtocolProfile ?? "auto"
      }
    };
  }

  protected resolveExposedCanonicalTools(args: BuildModelRequestArgs): CanonicalToolSpec[] {
    const exposedIds = new Set(args.exposurePlan.exposedTools.map((item) => item.canonicalToolId));
    return args.canonicalTools.filter((tool) => exposedIds.has(tool.id));
  }

  abstract buildModelRequest(args: BuildModelRequestArgs): UnifiedModelRequest;

  parseModelToolSignal(args: {
    finalResult?: UnifiedModelFinalResult;
    raw?: unknown;
    canonicalTools: CanonicalToolSpec[];
  }): CanonicalToolCallIntent[] {
    return parseFunctionToolCalls({
      finalResult: args.finalResult,
      adapterKind: this.kind,
      canonicalTools: args.canonicalTools
    });
  }
}

class ResponsesNativeExposureAdapter extends BaseExposureAdapter {
  constructor() {
    super("responses_native");
  }

  buildModelRequest(args: BuildModelRequestArgs): UnifiedModelRequest {
    const tools = this.resolveExposedCanonicalTools(args);
    return {
      ...args.baseRequest,
      apiMode: "responses",
      tools: tools.length > 0 ? buildFunctionTools(tools) : undefined,
      toolChoice: tools.length > 0 ? "auto" : "none",
      responseFormat: undefined,
      promptProtocol: undefined
    };
  }
}

class ChatFunctionExposureAdapter extends BaseExposureAdapter {
  constructor() {
    super("chat_function");
  }

  buildModelRequest(args: BuildModelRequestArgs): UnifiedModelRequest {
    const tools = this.resolveExposedCanonicalTools(args);
    return {
      ...args.baseRequest,
      apiMode: "chat_completions",
      tools: tools.length > 0 ? buildFunctionTools(tools) : undefined,
      toolChoice: tools.length > 0 ? "auto" : "none",
      responseFormat: undefined,
      promptProtocol: undefined
    };
  }
}

class ChatCustomExposureAdapter extends BaseExposureAdapter {
  constructor() {
    super("chat_custom");
  }

  buildModelRequest(args: BuildModelRequestArgs): UnifiedModelRequest {
    const tools = this.resolveExposedCanonicalTools(args);
    const messages = appendDeveloperMessage(
      args.baseRequest.messages,
      [
        "你可以调用 custom tools。",
        "若工具参数不完整，请先询问再调用。",
        "若工具不可用，请直接说明原因。"
      ].join("\n")
    );
    return {
      ...args.baseRequest,
      apiMode: "chat_completions",
      messages,
      tools: tools.length > 0 ? buildCustomTools(tools) : undefined,
      toolChoice: tools.length > 0 ? "auto" : "none",
      responseFormat: undefined,
      promptProtocol: undefined
    };
  }

  parseModelToolSignal(args: {
    finalResult?: UnifiedModelFinalResult;
    raw?: unknown;
    canonicalTools: CanonicalToolSpec[];
  }): CanonicalToolCallIntent[] {
    const fromNative = parseFunctionToolCalls({
      finalResult: args.finalResult,
      adapterKind: this.kind,
      canonicalTools: args.canonicalTools
    });
    if (fromNative.length > 0) return fromNative;
    const text = args.finalResult?.text ?? "";
    return parseTextSignalsToIntents({
      text,
      adapterKind: this.kind,
      canonicalTools: args.canonicalTools
    });
  }
}

class StructuredOutputExposureAdapter extends BaseExposureAdapter {
  constructor() {
    super("structured_output_tool_call");
  }

  buildModelRequest(args: BuildModelRequestArgs): UnifiedModelRequest {
    const tools = this.resolveExposedCanonicalTools(args);
    const toolNames = tools.map((tool) => tool.name);
    const messages = appendDeveloperMessage(
      args.baseRequest.messages,
      [
        "当你需要调用工具时，必须输出 JSON，并遵守 response_format 的 schema。",
        `可用工具: ${toolNames.length > 0 ? toolNames.join(", ") : "（无）"}`,
        "tool_calls[].arguments 必须是对象；若无需调用工具，请输出 tool_calls: []。"
      ].join("\n")
    );
    return {
      ...args.baseRequest,
      messages,
      tools: undefined,
      toolChoice: "none",
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "tool_protocol_response",
          strict: false,
          schema: {
            type: "object",
            properties: {
              response_text: { type: "string" },
              tool_calls: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    arguments: { type: "object", additionalProperties: true }
                  },
                  required: ["name", "arguments"],
                  additionalProperties: true
                }
              }
            },
            required: ["response_text", "tool_calls"],
            additionalProperties: true
          } as JsonObject
        }
      },
      promptProtocol: undefined
    };
  }

  parseModelToolSignal(args: {
    finalResult?: UnifiedModelFinalResult;
    raw?: unknown;
    canonicalTools: CanonicalToolSpec[];
  }): CanonicalToolCallIntent[] {
    const text = args.finalResult?.text ?? "";
    return parseTextSignalsToIntents({
      text,
      adapterKind: this.kind,
      canonicalTools: args.canonicalTools
    });
  }
}

class PromptProtocolExposureAdapter extends BaseExposureAdapter {
  constructor() {
    super("prompt_protocol_fallback");
  }

  buildModelRequest(args: BuildModelRequestArgs): UnifiedModelRequest {
    const tools = this.resolveExposedCanonicalTools(args);
    const instruction = [
      "当且仅当需要调用工具时，请输出如下协议代码块（不要附加解释）：",
      "```tool_call",
      '{"name":"tool_name","arguments":{"key":"value"}}',
      "```",
      "可用工具列表：",
      tools.map((tool) => `- ${tool.name}: ${toolDescByLevel(tool)}`).join("\n") || "- （无）"
    ].join("\n");
    return {
      ...args.baseRequest,
      messages: appendDeveloperMessage(args.baseRequest.messages, instruction),
      tools: undefined,
      toolChoice: "none",
      responseFormat: undefined,
      promptProtocol: {
        name: "tool_call_block_v1",
        instruction
      }
    };
  }

  parseModelToolSignal(args: {
    finalResult?: UnifiedModelFinalResult;
    raw?: unknown;
    canonicalTools: CanonicalToolSpec[];
  }): CanonicalToolCallIntent[] {
    const text = args.finalResult?.text ?? "";
    return parseTextSignalsToIntents({
      text,
      adapterKind: this.kind,
      canonicalTools: args.canonicalTools
    });
  }
}

export const exposureAdapters: Record<ToolExposureAdapterKind, ToolExposureAdapter> = {
  responses_native: new ResponsesNativeExposureAdapter(),
  chat_function: new ChatFunctionExposureAdapter(),
  chat_custom: new ChatCustomExposureAdapter(),
  structured_output_tool_call: new StructuredOutputExposureAdapter(),
  prompt_protocol_fallback: new PromptProtocolExposureAdapter()
};

/**
 * 自动策略选择器：
 * - 第一优先级：模型路由中声明的 toolProtocolProfile；
 * - 第二优先级：run override；
 * - 第三优先级：按 vendor/apiMode 自动推断。
 */
export function selectToolExposureAdapter(req: ToolExposureBuildRequest): {
  adapter: ToolExposureAdapter;
  fallbackChain: ToolExposureAdapterKind[];
} {
  const profile = req.provider.toolProtocolProfile ?? "auto";
  if (profile !== "auto") {
    if (profile === "openai_responses") {
      return {
        adapter: exposureAdapters.responses_native,
        fallbackChain: ["chat_function", "structured_output_tool_call", "prompt_protocol_fallback"]
      };
    }
    if (profile === "openai_chat_function") {
      return {
        adapter: exposureAdapters.chat_function,
        fallbackChain: ["structured_output_tool_call", "prompt_protocol_fallback"]
      };
    }
    if (profile === "openai_chat_custom") {
      return {
        adapter: exposureAdapters.chat_custom,
        fallbackChain: ["chat_function", "structured_output_tool_call", "prompt_protocol_fallback"]
      };
    }
    if (profile === "openai_compat_function_only") {
      return {
        adapter: exposureAdapters.chat_function,
        fallbackChain: ["structured_output_tool_call", "prompt_protocol_fallback"]
      };
    }
    if (profile === "structured_output_first") {
      return {
        adapter: exposureAdapters.structured_output_tool_call,
        fallbackChain: ["prompt_protocol_fallback"]
      };
    }
    if (profile === "prompt_protocol_only") {
      return {
        adapter: exposureAdapters.prompt_protocol_fallback,
        fallbackChain: []
      };
    }
  }

  if (req.override?.preferredAdapter) {
    return {
      adapter: exposureAdapters[req.override.preferredAdapter],
      fallbackChain: req.override.fallbackAdapters ?? []
    };
  }

  if (req.provider.apiMode === "responses") {
    return {
      adapter: exposureAdapters.responses_native,
      fallbackChain: ["chat_function", "structured_output_tool_call", "prompt_protocol_fallback"]
    };
  }

  if (req.provider.vendor === "openai") {
    return {
      adapter: exposureAdapters.chat_function,
      fallbackChain: ["chat_custom", "structured_output_tool_call", "prompt_protocol_fallback"]
    };
  }

  return {
    adapter: exposureAdapters.chat_function,
    fallbackChain: ["structured_output_tool_call", "prompt_protocol_fallback"]
  };
}
