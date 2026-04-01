/**
 * 本文件作用：
 * - 定义不同 Provider 的能力矩阵（v0.1）。
 * - 在发请求前进行能力校验，避免静默吞参数。
 */

import type { ProviderCapabilities, ProviderErrorShape, UnifiedModelRequest } from "../types/index.js";

/**
 * 根据 vendor 返回静态能力矩阵。
 *
 * 设计说明：
 * - 这里先采用“代码内建能力表”，优点是直观、稳定、易 review；
 * - 后续如果要做更细粒度的模型级能力差异，可以再扩展到按 model/profile 判断。
 */
export function getProviderCapabilities(vendor: UnifiedModelRequest["vendor"]): ProviderCapabilities {
  if (vendor === "openai") {
    // OpenAI 当前同时支持 chat/completions 与 responses，因此两种 apiMode 都放行。
    return {
      vendor,
      apiModes: ["chat_completions", "responses"],
      supportsTools: true,
      supportsStreaming: true,
      supportsReasoningEffort: true,
      supportsThoughts: false,
      supportsResponsesApi: true,
      supportsResponseFormatJsonSchema: true
    };
  }

  if (vendor === "gemini_openai_compat") {
    // Gemini 目前在本项目中走 OpenAI-compatible chat 接口，不走 Responses。
    return {
      vendor,
      apiModes: ["chat_completions"],
      supportsTools: true,
      supportsStreaming: true,
      supportsReasoningEffort: true,
      supportsThoughts: true,
      supportsResponsesApi: false,
      supportsResponseFormatJsonSchema: true
    };
  }

  if (vendor === "generic_openai_compat") {
    // generic_openai_compat 代表“只保证最常见兼容字段”的保守模式，
    // 所以 reasoning/thoughts/json_schema 这些高阶能力默认先关掉。
    return {
      vendor,
      apiModes: ["chat_completions"],
      supportsTools: true,
      supportsStreaming: true,
      supportsReasoningEffort: false,
      supportsThoughts: false,
      supportsResponsesApi: false,
      supportsResponseFormatJsonSchema: false
    };
  }

  // mock provider 默认能力最宽松，方便测试尽量覆盖更多运行时分支。
  return {
    vendor: "mock",
    apiModes: ["chat_completions", "responses"],
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsThoughts: true,
    supportsResponsesApi: true,
    supportsResponseFormatJsonSchema: true
  };
}

/**
 * 在正式发请求前做能力校验，尽早暴露“请求参数和 provider 不匹配”的问题。
 *
 * 返回值：
 * - `null`：说明当前请求与能力矩阵兼容，可以继续发请求；
 * - `ProviderErrorShape`：说明应在请求发出前直接失败，避免 provider 静默忽略参数。
 */
export function validateProviderRequestCapabilities(
  req: UnifiedModelRequest
): ProviderErrorShape | null {
  const caps = getProviderCapabilities(req.vendor);

  // 第一步先看“接口形态”是否支持，例如 responses 还是 chat/completions。
  if (!caps.apiModes.includes(req.apiMode)) {
    return {
      code: "UNSUPPORTED_API_MODE",
      message: `${req.vendor} 不支持 apiMode=${req.apiMode}`
    };
  }

  // tools 是三层工具架构的入口，如果 provider 明确不支持，要在这里提前拦住。
  if (req.tools && req.tools.length > 0 && !caps.supportsTools) {
    return {
      code: "UNSUPPORTED_TOOLS",
      message: `${req.vendor} 不支持 tools`
    };
  }

  // stream 控制的是 AgentRoundExecutor 是否能拿到增量事件。
  if (req.stream && !caps.supportsStreaming) {
    return {
      code: "UNSUPPORTED_STREAMING",
      message: `${req.vendor} 不支持 stream`
    };
  }

  // reasoning effort 是“要求模型以某个推理强度工作”的高阶参数，不是所有兼容层都支持。
  if (req.reasoningConfig?.effort && !caps.supportsReasoningEffort) {
    return {
      code: "UNSUPPORTED_REASONING_EFFORT",
      message: `${req.vendor} 不支持 reasoning effort 参数`
    };
  }

  // includeThoughts 更进一步要求 provider 返回思考摘要，因此要单独校验。
  if (req.reasoningConfig?.includeThoughts && !caps.supportsThoughts) {
    return {
      code: "UNSUPPORTED_THOUGHTS",
      message: `${req.vendor} 不支持 thoughts/思考摘要输出`
    };
  }

  // 结构化输出的 json_schema 能力，在 generic 兼容层里最容易被“看起来支持、实际静默忽略”。
  // 因此这里提前拦截，避免后续调试时误以为是 prompt 或解析器有问题。
  if (req.responseFormat?.type === "json_schema" && !caps.supportsResponseFormatJsonSchema) {
    return {
      code: "UNSUPPORTED_RESPONSE_FORMAT_JSON_SCHEMA",
      message: `${req.vendor} 当前能力配置不支持 response_format=json_schema`
    };
  }

  return null;
}
