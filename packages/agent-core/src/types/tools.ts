import type { JsonObject, JsonValue, SimpAgentId } from "./common.js";

/**
 * 工具定义使用 OpenAI Chat Completions 的 function tool 形状作为公共抽象。
 * runtime 只负责执行工具，core 负责审批、事件和回填 tool result。
 */

export type ApprovalPolicy = "ask" | "deny" | "always_approve";

/**
 * ToolDefinition 是工具注册时的规范描述，形状对齐 OpenAI function tool。
 */
export interface ToolDefinition {
  readonly id: SimpAgentId;
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonObject;
}

/**
 * 模型发起的一次工具调用请求。
 */
export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly argumentsText: string;
}

/**
 * 人审请求对象：包含原始调用、解析参数和风险摘要。
 */
export interface ToolApprovalRequest {
  readonly threadId: SimpAgentId;
  readonly turnId: SimpAgentId;
  readonly toolCall: ToolCallRequest;
  readonly parsedArguments: JsonValue;
  readonly riskSummary: string;
}

export type ToolApprovalDecision = "approve" | "deny";

export interface ToolApprovalResult {
  readonly decision: ToolApprovalDecision;
  readonly reason?: string;
}

export interface ToolExecutionResult {
  readonly ok: boolean;
  readonly content: JsonValue;
}

/**
 * ToolExecutor 由 runtime 注入，负责工具的实际执行。
 */
export interface ToolExecutor {
  listTools(): readonly ToolDefinition[];
  executeTool(toolCall: ToolCallRequest): Promise<ToolExecutionResult>;
}

/**
 * 固定拒绝结果：当人审拒绝时回填给模型，而不是直接抛异常中断。
 */
export const deniedToolResult: ToolExecutionResult = {
  ok: false,
  content: {
    ok: false,
    errorCode: "TOOL_EXECUTION_DENIED_BY_HUMAN",
    message: "用户拒绝执行该工具调用"
  }
};

