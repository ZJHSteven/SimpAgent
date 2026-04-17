/**
 * 本文件实现单次 turn 的核心执行循环（Agent Loop）。
 * 典型流程：
 * user -> model -> tool_calls -> human approval -> tool_result -> model -> ... -> done
 */
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
  readonly maxToolIterations?: number;
  readonly onEvent: (event: AgentEvent) => void | Promise<void>;
}

export interface RunAgentTurnResult {
  readonly messages: readonly ContextMessage[];
  readonly trace: TraceRecord;
}

/**
 * 解析工具参数：空字符串视为 {}，否则按 JSON 解析。
 */
function parseToolArguments(toolCall: ToolCallRequest): unknown {
  if (toolCall.argumentsText.trim().length === 0) {
    return {};
  }

  return JSON.parse(toolCall.argumentsText);
}

/**
 * 将工具结果序列化为可写入 tool 消息的文本。
 */
function stringifyToolResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * 执行单次 Agent turn。
 * 说明：
 * - maxToolIterations 用于防止异常循环导致无限调用工具。
 * - 过程中的关键片段会进入 trace（请求、响应事件、审批、执行结果）。
 */
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
  const requests = [];

  await input.onEvent({
    type: "run_started",
    threadId: input.threadId,
    turnId: input.turnId,
    runId: input.runId
  });

  for (let iteration = 0; iteration < (input.maxToolIterations ?? 3); iteration += 1) {
    // 每一轮都带上当前上下文与可用工具，向模型请求下一步动作。
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
    requests.push(adapterResponse.request);

    let assistantText = "";
    let thinkingText = "";

    for (const event of adapterResponse.events) {
      responseEvents.push(event);

      if (event.type === "message_delta") {
        // 实时把增量透传给上层订阅者（例如 SSE 客户端）。
        assistantText += event.delta;
        await input.onEvent({
          type: "message_delta",
          threadId: input.threadId,
          turnId: input.turnId,
          delta: event.delta
        });
      }

      if (event.type === "thinking_delta") {
        // thinking 只做本地回放和诊断，不直接回给最终用户界面（由上层决定）。
        thinkingText += event.delta;
        await input.onEvent({
          type: "thinking_delta",
          threadId: input.threadId,
          turnId: input.turnId,
          delta: event.delta
        });
      }
    }

    const toolCalls = assembleToolCalls(adapterResponse.events);

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

    if (assistantText.length > 0 || toolCalls.length > 0) {
      // 即使 assistantText 为空，只要有 toolCalls，也要落一条 assistant 消息承载调用信息。
      currentMessages.push(
        createTextMessage({
          id: input.idGenerator.nextId("msg"),
          role: "assistant",
          content: assistantText,
          turnId: input.turnId,
          ...(toolCalls.length === 0 ? {} : { toolCalls })
        })
      );
    }

    if (toolCalls.length === 0) {
      // 没有工具调用时，说明这一轮可直接结束。
      break;
    }

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
        // 审批策略优先由配置决定，ask 才走 runtime 的人审流程。
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
        // 工具结果通过 tool 角色消息回填给模型，驱动下一轮继续推理。
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
  }

  const firstRequest = requests[0];
  // 同时保留 request（首请求）和 requests（完整序列），兼顾简洁展示与完整追溯。
  const traceWithoutFirstRequest = {
    threadId: input.threadId,
    turnId: input.turnId,
    createdAt,
    requests,
    responseEvents: responseEvents as never,
    toolApprovals: toolApprovals as never,
    toolResults: toolResults as never,
    errors: errors as never,
    metrics: {
      requestCount: requests.length
    }
  };
  const trace: TraceRecord =
    firstRequest === undefined
      ? traceWithoutFirstRequest
      : {
          ...traceWithoutFirstRequest,
          request: firstRequest
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
