/**
 * 本文件定义 Agent 在运行过程中的事件协议，并提供 SSE 编码辅助函数。
 * 前端或上层服务可以订阅这些事件，实现实时 UI 回放与调试。
 */
import type { JsonObject, JsonValue, SimpAgentId } from "./common.js";
import type { ToolApprovalRequest, ToolCallRequest, ToolExecutionResult } from "./tools.js";

/**
 * AgentEvent 是统一事件联合类型。
 * 采用 discriminated union（type 字段）以便 switch 时拿到精确类型缩小。
 */
export type AgentEvent =
  | {
      readonly type: "run_started";
      readonly threadId: SimpAgentId;
      readonly turnId: SimpAgentId;
      readonly runId: SimpAgentId;
    }
  | {
      readonly type: "message_delta";
      readonly threadId: SimpAgentId;
      readonly turnId: SimpAgentId;
      readonly delta: string;
    }
  | {
      readonly type: "thinking_delta";
      readonly threadId: SimpAgentId;
      readonly turnId: SimpAgentId;
      readonly delta: string;
    }
  | {
      readonly type: "tool_call";
      readonly threadId: SimpAgentId;
      readonly turnId: SimpAgentId;
      readonly toolCall: ToolCallRequest;
    }
  | {
      readonly type: "tool_approval_requested";
      readonly request: ToolApprovalRequest;
    }
  | {
      readonly type: "tool_result";
      readonly threadId: SimpAgentId;
      readonly turnId: SimpAgentId;
      readonly toolCallId: string;
      readonly result: ToolExecutionResult;
    }
  | {
      readonly type: "handoff";
      readonly threadId: SimpAgentId;
      readonly turnId: SimpAgentId;
      readonly toolCallId: string;
      readonly targetNodeId: string;
      readonly inputMarkdown: string;
      readonly returnMode: string;
    }
  | {
      readonly type: "trace_snapshot";
      readonly threadId: SimpAgentId;
      readonly turnId: SimpAgentId;
      readonly trace: JsonObject;
    }
  | {
      readonly type: "error";
      readonly threadId?: SimpAgentId;
      readonly turnId?: SimpAgentId;
      readonly errorCode: string;
      readonly message: string;
      readonly details?: JsonValue;
    }
  | {
      readonly type: "done";
      readonly threadId: SimpAgentId;
      readonly turnId: SimpAgentId;
      readonly runId: SimpAgentId;
    };

/**
 * 将内部事件编码成标准 SSE 文本块。
 * 形如：
 * event: xxx
 * data: {...json...}
 */
export function encodeSseEvent(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
