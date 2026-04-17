/**
 * 本文件定义“模型适配层（Adapter）”和“HTTP 观测信息”的核心类型。
 *
 * 设计目的：
 * 1) 把上层 Agent Loop 与具体模型厂商协议解耦。
 * 2) 统一流式事件（文本增量 / 思考增量 / 工具调用增量）表达。
 * 3) 让 trace 与调试能力能够记录请求/响应关键指标。
 */
import type { JsonObject, SimpAgentId } from "./common.js";
import type { ContextMessage } from "./messages.js";
import type { ToolDefinition } from "./tools.js";

/**
 * 当前支持的 provider 类型。
 * 说明：这里用字符串字面量联合，方便在编译期限制可选值。
 */
export type ApiProviderKind = "openai-chat-completions" | "deepseek-chat-completions";

/**
 * 一个 provider 策略是一组“可执行配置快照”，用于驱动一次模型调用。
 */
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

/**
 * 发送给 Adapter 的标准输入。
 * 其中 tools 为可调用工具定义，stream 控制是否启用流式输出。
 */
export interface ChatCompletionAdapterInput {
  readonly strategy: ProviderStrategy;
  readonly messages: readonly ContextMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly stream: boolean;
  readonly extra?: JsonObject;
}

/**
 * 用于 trace 的 HTTP 请求观测对象（脱离 fetch 实现细节）。
 */
export interface ObservableHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: JsonObject;
}

/**
 * 统一流式事件：
 * - message_delta: 正文 token 增量
 * - thinking_delta: 思考/推理 token 增量
 * - tool_call_delta: 工具调用的分片增量
 * - done: 一次流式输出结束
 */
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

  /**
   * 模型 token 使用量（不同厂商字段可能有差异，故全部可选）。
   */
export interface AdapterUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

/**
 * 一次 Adapter 调用的汇总响应。
 * 注意：events 已经是解析后的统一格式，不再暴露厂商原始分片。
 */
export interface ChatCompletionAdapterResponse {
  readonly request: ObservableHttpRequest;
  readonly status: number;
  readonly requestId?: string;
  readonly firstTokenMs?: number;
  readonly totalMs: number;
  readonly events: readonly AdapterStreamEvent[];
  readonly usage?: AdapterUsage;
}

/**
 * 轻量 fetch 抽象，便于测试中注入 mock fetch。
 */
export interface FetchLike {
  (input: string, init: RequestInit): Promise<Response>;
}

