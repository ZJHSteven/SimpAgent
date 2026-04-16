import { assembleToolCalls, sendChatCompletionsRequest } from "../api/chat-completions.js";
import type { FetchLike, ProviderStrategy } from "../types/api.js";
import type { IdGenerator, RuntimeClock } from "../types/common.js";
import { createTextMessage, type ContextMessage } from "../types/messages.js";
import type { AgentEvent } from "../types/events.js";
import type { TraceRecord, TraceStore } from "../types/trace.js";
import type {
  ApprovalPolicy,
  ToolApprovalRequest,
  ToolCallRequest,
  ToolExecutor
} from "../types/tools.js";
import { deniedToolResult } from "../types/tools.js";
import type { RuntimeServices } from "../runtime/interfaces.js";

export interface RunAgentTurnInput {
  readonly runId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly messages: readonly ContextMessage[];
  readonly userText: string;
  readonly strategy: ProviderStrategy;
  readonly toolExecutor: ToolExecutor;
  readonly runtime: RuntimeServices;
  readonly traceStore: TraceStore;
  readonly fetchFn: FetchLike;
  readonly clock: RuntimeClock;
  readonly idGenerator: IdGenerator;
  readonly approvalPolicy: ApprovalPolicy;
  readonly onEvent: (event: AgentEvent) => void | Promise<void>;
}

export interface RunAgentTurnResult {
  readonly messages: readonly ContextMessage[];
  readonly trace: TraceRecord;
}

function parseToolArguments(toolCall: ToolCallRequest): unknown {
  if (toolCall.argumentsText.trim().length === 0) {
    return {};
  }

  return JSON.parse(toolCall.argumentsText);
}

function stringifyToolResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnResult> {
  const createdAt = input.clock.now();
  const currentMessages: ContextMessage[] = [
    ...input.messages,
    createTextMessage({
      id: input.idGenerator.nextId("msg"),
      role: "user",
      content: input.userText,
      turnId: input.turnId
    })
  ];
  const responseEvents: unknown[] = [];
  const toolApprovals: unknown[] = [];
  const toolResults: unknown[] = [];
  const errors: unknown[] = [];

  await input.onEvent({
    type: "run_started",
    threadId: input.threadId,
    turnId: input.turnId,
    runId: input.runId
  });

  const adapterResponse = await sendChatCompletionsRequest({
    adapterInput: {
      strategy: input.strategy,
      messages: currentMessages,
      tools: input.toolExecutor.listTools(),
      stream: true
    },
    fetchFn: input.fetchFn,
    clock: input.clock
  });

  let assistantText = "";
  let thinkingText = "";

  for (const event of adapterResponse.events) {
    responseEvents.push(event);

    if (event.type === "message_delta") {
      assistantText += event.delta;
      await input.onEvent({
        type: "message_delta",
        threadId: input.threadId,
        turnId: input.turnId,
        delta: event.delta
      });
    }

    if (event.type === "thinking_delta") {
      thinkingText += event.delta;
      await input.onEvent({
        type: "thinking_delta",
        threadId: input.threadId,
        turnId: input.turnId,
        delta: event.delta
      });
    }
  }

  if (thinkingText.length > 0) {
    currentMessages.push(
      createTextMessage({
        id: input.idGenerator.nextId("msg"),
        role: "thinking",
        content: thinkingText,
        turnId: input.turnId
      })
    );
  }

  if (assistantText.length > 0) {
    currentMessages.push(
      createTextMessage({
        id: input.idGenerator.nextId("msg"),
        role: "assistant",
        content: assistantText,
        turnId: input.turnId
      })
    );
  }

  const toolCalls = assembleToolCalls(adapterResponse.events);

  for (const toolCall of toolCalls) {
    await input.onEvent({
      type: "tool_call",
      threadId: input.threadId,
      turnId: input.turnId,
      toolCall
    });

    const approvalRequest: ToolApprovalRequest = {
      threadId: input.threadId,
      turnId: input.turnId,
      toolCall,
      parsedArguments: parseToolArguments(toolCall) as never,
      riskSummary: `工具 ${toolCall.name} 即将执行。`
    };

    await input.onEvent({
      type: "tool_approval_requested",
      request: approvalRequest
    });

    const approval =
      input.approvalPolicy === "always_approve"
        ? { decision: "approve" as const, reason: "配置允许自动执行工具。" }
        : input.approvalPolicy === "deny"
          ? { decision: "deny" as const, reason: "配置拒绝所有工具。" }
          : await input.runtime.approvalRuntime.requestApproval(approvalRequest);

    toolApprovals.push({ request: approvalRequest, approval });

    const result =
      approval.decision === "approve"
        ? await input.toolExecutor.executeTool(toolCall)
        : deniedToolResult;

    toolResults.push({ toolCall, result });

    currentMessages.push(
      createTextMessage({
        id: input.idGenerator.nextId("msg"),
        role: "tool",
        content: stringifyToolResult(result.content),
        turnId: input.turnId,
        toolCallId: toolCall.id,
        name: toolCall.name
      })
    );

    await input.onEvent({
      type: "tool_result",
      threadId: input.threadId,
      turnId: input.turnId,
      toolCallId: toolCall.id,
      result
    });
  }

  const trace: TraceRecord = {
    threadId: input.threadId,
    turnId: input.turnId,
    createdAt,
    request: adapterResponse.request,
    responseEvents: responseEvents as never,
    toolApprovals: toolApprovals as never,
    toolResults: toolResults as never,
    errors: errors as never,
    metrics: {
      status: adapterResponse.status,
      totalMs: adapterResponse.totalMs,
      firstTokenMs: adapterResponse.firstTokenMs ?? null
    }
  };

  await input.traceStore.saveTrace(trace);
  await input.onEvent({
    type: "trace_snapshot",
    threadId: input.threadId,
    turnId: input.turnId,
    trace: trace as unknown as never
  });
  await input.onEvent({
    type: "done",
    threadId: input.threadId,
    turnId: input.turnId,
    runId: input.runId
  });

  return {
    messages: currentMessages,
    trace
  };
}
