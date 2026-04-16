import type { SimpAgentId } from "./common.js";
import type { ContextMessage } from "./messages.js";

export interface AgentDefinition {
  readonly id: SimpAgentId;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly toolNames: readonly string[];
  readonly providerStrategyId: SimpAgentId;
}

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

export interface TurnState {
  readonly id: SimpAgentId;
  readonly threadId: SimpAgentId;
  readonly createdAt: number;
  readonly completedAt?: number;
  readonly status: "running" | "waiting_for_tool_approval" | "completed" | "failed";
}

