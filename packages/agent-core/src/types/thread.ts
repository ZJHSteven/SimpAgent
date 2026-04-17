/**
 * 本文件定义 Agent、Thread、Turn 三层状态模型。
 * - AgentDefinition: 静态角色配置
 * - ThreadState: 会话级状态
 * - TurnState: 单次运行状态
 */
import type { SimpAgentId } from "./common.js";
import type { ContextMessage } from "./messages.js";

/**
 * Agent 的静态定义。
 * toolNames 指定该 agent 可见的工具白名单。
 */
export interface AgentDefinition {
  readonly id: SimpAgentId;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly toolNames: readonly string[];
  readonly providerStrategyId: SimpAgentId;
}

/**
 * Thread 表示一个可持续追加消息的会话。
 * fork 信息用于支持“从某条历史消息开分支”。
 */
export interface ThreadState {
  readonly id: SimpAgentId;
  readonly agentId: SimpAgentId;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly ContextMessage[];
  readonly parentThreadId?: SimpAgentId;
  readonly forkedFromMessageId?: SimpAgentId;
}

/**
 * Turn 表示 thread 内的一次运行尝试。
 */
export interface TurnState {
  readonly id: SimpAgentId;
  readonly threadId: SimpAgentId;
  readonly createdAt: number;
  readonly completedAt?: number;
  readonly status: "running" | "waiting_for_tool_approval" | "completed" | "failed";
}

