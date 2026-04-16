import type { JsonObject, JsonValue, SimpAgentId } from "./common.js";
import type { ToolApprovalRequest, ToolCallRequest, ToolExecutionResult } from "./tools.js";

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

export function encodeSseEvent(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

