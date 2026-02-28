/**
 * 本文件作用：
 * - 执行“单轮模型流式调用”，收集文本/推理/工具调用并实时产出 trace。
 *
 * 教学说明：
 * - 这是 runtime 真流式化的关键步骤；
 * - 它只负责“一轮模型生成”，不负责工具循环（工具循环由 ToolLoopExecutor 驱动）。
 */

import type {
  JsonValue,
  UnifiedModelFinalResult,
  UnifiedModelRequest,
  UnifiedModelStreamEvent
} from "../types/index.js";
import { ToolCallAssembler } from "./toolCallAssembler.js";

export interface AgentRoundExecutorTraceContext {
  runId: string;
  threadId: string;
  nodeId: string;
  agentId: string;
}

export interface AgentRoundTraceSink {
  onEvent(args: {
    kind: "stream_event" | "tool_call_detected";
    ctx: AgentRoundExecutorTraceContext;
    summary: string;
    payload?: JsonValue;
  }): void;
}

export interface AgentRoundExecuteResult extends UnifiedModelFinalResult {
  rawStreamEventsCount: number;
}

/**
 * 模型流式端口：
 * - 核心层只依赖“能 stream 统一请求”的能力；
 * - 具体由 Node/Worker/Tauri 适配层实现。
 */
export interface AgentModelPort {
  stream(req: UnifiedModelRequest): AsyncIterable<UnifiedModelStreamEvent>;
}

export class AgentRoundExecutor {
  constructor(private readonly modelPort: AgentModelPort, private readonly traceSink?: AgentRoundTraceSink) {}

  async executeRound(
    req: UnifiedModelRequest,
    ctx: AgentRoundExecutorTraceContext
  ): Promise<AgentRoundExecuteResult> {
    const textParts: string[] = [];
    const thoughts: string[] = [];
    let reasoningSummary: string | undefined;
    let usage: JsonValue | undefined;
    let rawEventsCount = 0;
    let provider = req.vendor;
    let apiMode = req.apiMode;
    let model = req.model;
    const assembler = new ToolCallAssembler();

    for await (const event of this.modelPort.stream({ ...req, stream: true })) {
      rawEventsCount += 1;
      if (event.type === "response_started") {
        provider = event.provider;
        apiMode = (event.apiMode ?? apiMode) as typeof apiMode;
        model = event.model ?? model;
        continue;
      }

      if (event.type === "text_delta") {
        textParts.push(event.delta);
        this.traceSink?.onEvent({
          kind: "stream_event",
          ctx,
          summary: `模型增量输出 ${event.delta.length} chars`,
          payload: { type: "text_delta", delta: event.delta.slice(0, 1200) } as unknown as JsonValue
        });
        continue;
      }

      if (event.type === "tool_call_request") {
        const pushed = assembler.push(event);
        this.traceSink?.onEvent({
          kind: "tool_call_detected",
          ctx,
          summary: `检测到工具调用分片：${pushed.toolName}`,
          payload: {
            toolCallId: pushed.toolCallId,
            toolName: pushed.toolName,
            argumentsDeltaPreview: event.argumentsDelta?.slice(0, 500) ?? null,
            jsonReady: pushed.jsonReady
          } as unknown as JsonValue
        });
        continue;
      }

      if (event.type === "reasoning") {
        if (event.reasoningSummary) reasoningSummary = event.reasoningSummary;
        if (event.thoughts?.length) thoughts.push(...event.thoughts);
        this.traceSink?.onEvent({
          kind: "stream_event",
          ctx,
          summary: "收到模型推理/思考摘要",
          payload: {
            type: "reasoning",
            reasoningSummary: event.reasoningSummary ?? null,
            thoughtsCount: event.thoughts?.length ?? 0
          } as unknown as JsonValue
        });
        continue;
      }

      if (event.type === "response_completed") {
        usage = event.usage;
        continue;
      }

      // raw_event 也记录到 trace，但截断避免过大。
      this.traceSink?.onEvent({
        kind: "stream_event",
        ctx,
        summary: "收到 provider 原始流事件",
        payload: {
          type: "raw_event",
          event: event.type === "raw_event" ? event.event : null
        } as unknown as JsonValue
      });
    }

    return {
      provider,
      apiMode,
      model,
      text: textParts.join(""),
      toolCalls: assembler.finalize(),
      reasoningSummary,
      thoughts: thoughts.length > 0 ? thoughts : undefined,
      usage: (usage as any) ?? undefined,
      raw: undefined,
      rawStreamEventsCount: rawEventsCount
    };
  }
}
