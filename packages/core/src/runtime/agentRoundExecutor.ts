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

  /**
   * 执行“一轮模型流式调用”。
   *
   * 输入：
   * - `req`：本轮模型请求；
   * - `ctx`：trace 归属上下文（run / thread / node / agent）。
   *
   * 输出：
   * - 返回这一轮最终汇总出的文本、工具调用、推理摘要和 usage；
   * - 不直接执行工具，工具循环由外层 `ToolLoopExecutor` 负责。
   */
  async executeRound(
    req: UnifiedModelRequest,
    ctx: AgentRoundExecutorTraceContext
  ): Promise<AgentRoundExecuteResult> {
    // 文本通常按 delta 分片到达，所以先收集片段，最后统一拼接。
    const textParts: string[] = [];
    // thoughts 可能多次返回，因此累加；reasoningSummary 则只保留最近一次摘要。
    const thoughts: string[] = [];
    let reasoningSummary: string | undefined;
    let usage: JsonValue | undefined;
    // 原始事件数能帮助我们判断 provider 是否真的在流式吐事件。
    let rawEventsCount = 0;
    // 某些 provider 会在开始事件中回填“实际生效的 model / apiMode”。
    let provider = req.vendor;
    let apiMode = req.apiMode;
    let model = req.model;
    // ToolCallAssembler 负责把分片 tool_call 参数重组成完整 JSON。
    const assembler = new ToolCallAssembler();

    for await (const event of this.modelPort.stream({ ...req, stream: true })) {
      rawEventsCount += 1;
      if (event.type === "response_started") {
        // 以响应层实际值为准，避免请求参数和最终展示信息不一致。
        provider = event.provider;
        apiMode = (event.apiMode ?? apiMode) as typeof apiMode;
        model = event.model ?? model;
        continue;
      }

      if (event.type === "text_delta") {
        // 文本增量一边累计，一边写 trace，便于前端做近实时渲染。
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
        // 这里只做“检测 + 组装”，不在这里执行工具，避免单轮执行和多轮循环耦合。
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
        // reasoningSummary 更适合展示；thoughts 更接近原始思考片段。
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
        // usage 往往在最后一个事件里最完整。
        usage = event.usage;
        continue;
      }

      // 其他暂未结构化的事件也保留 trace，避免调试时只知道“有怪事发生”却不知道事件内容。
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
      // 上层最终看到的是一整段 assistant 文本，因此在这里统一 join。
      text: textParts.join(""),
      // finalize 会对尚未完全 ready 的参数再做一次兜底解析。
      toolCalls: assembler.finalize(),
      reasoningSummary,
      thoughts: thoughts.length > 0 ? thoughts : undefined,
      usage: (usage as any) ?? undefined,
      raw: undefined,
      rawStreamEventsCount: rawEventsCount
    };
  }
}
