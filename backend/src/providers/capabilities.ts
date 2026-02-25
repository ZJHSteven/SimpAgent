/**
 * 本文件作用：
 * - 定义不同 Provider 的能力矩阵（v0.1）。
 * - 在发请求前进行能力校验，避免静默吞参数。
 */

import type { ProviderCapabilities, ProviderErrorShape, UnifiedModelRequest } from "../types/index.js";

export function getProviderCapabilities(vendor: UnifiedModelRequest["vendor"]): ProviderCapabilities {
  if (vendor === "openai") {
    return {
      vendor,
      apiModes: ["chat_completions", "responses"],
      supportsTools: true,
      supportsStreaming: true,
      supportsReasoningEffort: true,
      supportsThoughts: false,
      supportsResponsesApi: true
    };
  }

  if (vendor === "gemini_openai_compat") {
    return {
      vendor,
      apiModes: ["chat_completions"],
      supportsTools: true,
      supportsStreaming: true,
      supportsReasoningEffort: true,
      supportsThoughts: true,
      supportsResponsesApi: false
    };
  }

  if (vendor === "generic_openai_compat") {
    return {
      vendor,
      apiModes: ["chat_completions"],
      supportsTools: true,
      supportsStreaming: true,
      supportsReasoningEffort: false,
      supportsThoughts: false,
      supportsResponsesApi: false
    };
  }

  return {
    vendor: "mock",
    apiModes: ["chat_completions", "responses"],
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsThoughts: true,
    supportsResponsesApi: true
  };
}

export function validateProviderRequestCapabilities(
  req: UnifiedModelRequest
): ProviderErrorShape | null {
  const caps = getProviderCapabilities(req.vendor);

  if (!caps.apiModes.includes(req.apiMode)) {
    return {
      code: "UNSUPPORTED_API_MODE",
      message: `${req.vendor} 不支持 apiMode=${req.apiMode}`
    };
  }

  if (req.tools && req.tools.length > 0 && !caps.supportsTools) {
    return {
      code: "UNSUPPORTED_TOOLS",
      message: `${req.vendor} 不支持 tools`
    };
  }

  if (req.stream && !caps.supportsStreaming) {
    return {
      code: "UNSUPPORTED_STREAMING",
      message: `${req.vendor} 不支持 stream`
    };
  }

  if (req.reasoningConfig?.effort && !caps.supportsReasoningEffort) {
    return {
      code: "UNSUPPORTED_REASONING_EFFORT",
      message: `${req.vendor} 不支持 reasoning effort 参数`
    };
  }

  if (req.reasoningConfig?.includeThoughts && !caps.supportsThoughts) {
    return {
      code: "UNSUPPORTED_THOUGHTS",
      message: `${req.vendor} 不支持 thoughts/思考摘要输出`
    };
  }

  return null;
}

