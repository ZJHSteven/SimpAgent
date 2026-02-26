/**
 * 本文件作用：
 * - 定义“内层暴露适配层”的统一接口与默认策略选择器。
 * - 把 CanonicalToolSpec 转换为不同模型 API 可接受的暴露计划（ExposurePlan）。
 *
 * 教学说明：
 * - 这里不执行工具，只做“如何向模型展示工具”的策略决策。
 * - 真正执行工具仍然由 ToolRuntime / ToolRouter 完成。
 */

import { randomUUID } from "node:crypto";
import type {
  CanonicalToolCallIntent,
  CanonicalToolSpec,
  ProviderCapabilities,
  ProviderVendor,
  ToolExposureAdapterKind,
  ToolProtocolProfile,
  ToolExposurePlan,
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

/**
 * 内层暴露适配器接口（可替换插件）。
 */
export interface ToolExposureAdapter {
  readonly kind: ToolExposureAdapterKind;
  buildToolExposure(req: ToolExposureBuildRequest, canonicalTools: CanonicalToolSpec[]): ToolExposurePlan;
  /**
   * 从模型结果中解析工具信号，统一转换回 CanonicalToolCallIntent。
   * 说明：
   * - 首版先实现最小版（主要从 UnifiedModelFinalResult.toolCalls 转换）；
   * - 真流式版本会在 runtime 中结合 stream 事件分片组装。
   */
  parseModelToolSignal(args: {
    finalResult?: UnifiedModelFinalResult;
    raw?: unknown;
    canonicalTools: CanonicalToolSpec[];
  }): CanonicalToolCallIntent[];
}

function newPlanId(): string {
  return `texp_${randomUUID().replace(/-/g, "")}`;
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

function parseToolCallsFromUnifiedFinalResult(args: {
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
        payloadMode: "json_args" as const,
        args: call.argumentsJson
      });
  }
  return intents;
}

class SimpleExposureAdapter implements ToolExposureAdapter {
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
        apiMode: req.provider.apiMode
      }
    };
  }

  parseModelToolSignal(args: {
    finalResult?: UnifiedModelFinalResult;
    raw?: unknown;
    canonicalTools: CanonicalToolSpec[];
  }): CanonicalToolCallIntent[] {
    return parseToolCallsFromUnifiedFinalResult({
      finalResult: args.finalResult,
      adapterKind: this.kind,
      canonicalTools: args.canonicalTools
    });
  }
}

export const exposureAdapters: Record<ToolExposureAdapterKind, ToolExposureAdapter> = {
  responses_native: new SimpleExposureAdapter("responses_native"),
  chat_function: new SimpleExposureAdapter("chat_function"),
  chat_custom: new SimpleExposureAdapter("chat_custom"),
  structured_output_tool_call: new SimpleExposureAdapter("structured_output_tool_call"),
  prompt_protocol_fallback: new SimpleExposureAdapter("prompt_protocol_fallback")
};

/**
 * 自动策略选择器（最小版）：
 * - 优先尊重 override；
 * - 否则按 provider/apiMode 选择；
 * - 同时返回降级链路。
 */
export function selectToolExposureAdapter(req: ToolExposureBuildRequest): {
  adapter: ToolExposureAdapter;
  fallbackChain: ToolExposureAdapterKind[];
} {
  /**
   * 第一优先级：模型路由显式指定的协议画像。
   * 说明：
   * - 这是用户刚强调的核心点：由“模型/API 路由配置”决定内层暴露怎么走；
   * - 工具定义本身不需要知道 chat_function / structured / prompt 等实现细节。
   */
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
