/**
 * 本文件作用：
 * - 执行多轮“模型 -> 工具 -> 模型”的循环（直到无工具调用或达到上限）。
 *
 * 教学说明：
 * - 这是运行时层的能力，不属于 Provider 兼容层；
 * - Provider 层只负责把协议事件归一化，工具循环由 runtime 决策与执行。
 */

import type {
  JsonObject,
  JsonValue,
  ToolResult,
  UnifiedMessage,
  UnifiedModelRequest
} from "../types/index.js";
import type { AgentRoundExecuteResult, AgentRoundExecutor, AgentRoundExecutorTraceContext } from "./agentRoundExecutor.js";

export interface ToolLoopExecuteContext extends AgentRoundExecutorTraceContext {}

/**
 * 统一的“运行时检测到的工具调用”结构。
 * 说明：
 * - 不管是 provider 原生 function_call，还是 structured_output / prompt 协议文本解析，
 *   最终都转换为该结构，再进入统一工具执行流程。
 */
export interface DetectedToolCall {
  toolCallId: string;
  toolName: string;
  argumentsJson: JsonObject;
  canonicalToolId?: string;
  payloadMode?: "json_args" | "freeform_text" | "mixed";
  freeformText?: string;
  rawSignal?: JsonValue;
}

export interface ToolLoopExecuteParams {
  initialRequest: UnifiedModelRequest;
  roundExecutor: AgentRoundExecutor;
  ctx: ToolLoopExecuteContext;
  maxRounds: number;
  detectToolCalls?: (args: {
    roundIndex: number;
    round: AgentRoundExecuteResult;
  }) => Promise<DetectedToolCall[]>;
  onToolCalls: (args: {
    roundIndex: number;
    calls: DetectedToolCall[];
  }) => Promise<{
    toolRoleMessages: UnifiedMessage[];
    toolResults: ToolResult[];
  }>;
  /**
   * 当某些工具本身就代表“当前 agent 本轮应结束”时，
   * 允许 runtime 在工具执行后提前终止后续模型轮次。
   * 典型场景：handoff 工具已经明确把控制权交给下一个 agent。
   */
  shouldStopAfterToolCalls?: (args: {
    roundIndex: number;
    calls: DetectedToolCall[];
    toolResults: ToolResult[];
  }) => boolean;
}

export interface ToolLoopExecuteResult {
  finalText: string;
  finalMessages: UnifiedMessage[];
  allToolResults: ToolResult[];
  rounds: number;
  lastRound: AgentRoundExecuteResult;
}

export class ToolLoopExecutor {
  async execute(params: ToolLoopExecuteParams): Promise<ToolLoopExecuteResult> {
    let currentReq = { ...params.initialRequest };
    let currentMessages = [...(params.initialRequest.messages ?? [])];
    let finalText = "";
    const allToolResults: ToolResult[] = [];
    let lastRound: AgentRoundExecuteResult | null = null;

    for (let roundIndex = 0; roundIndex < Math.max(1, params.maxRounds); roundIndex++) {
      const round = await params.roundExecutor.executeRound(
        { ...currentReq, messages: currentMessages, stream: true },
        params.ctx
      );
      lastRound = round;
      finalText = round.text || finalText;

      const detectedCallsFromProvider: DetectedToolCall[] = round.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        argumentsJson: call.argumentsJson,
        payloadMode: "json_args"
      }));
      const detectedCalls =
        detectedCallsFromProvider.length > 0
          ? detectedCallsFromProvider
          : ((await params.detectToolCalls?.({
              roundIndex,
              round
            })) ?? []);

      if (!detectedCalls.length) {
        break;
      }

      const toolOutput = await params.onToolCalls({
        roundIndex,
        calls: detectedCalls
      });
      allToolResults.push(...toolOutput.toolResults);
      currentMessages = [...currentMessages, ...toolOutput.toolRoleMessages];
      currentReq = { ...currentReq, messages: currentMessages };
      if (
        params.shouldStopAfterToolCalls?.({
          roundIndex,
          calls: detectedCalls,
          toolResults: toolOutput.toolResults
        })
      ) {
        break;
      }
    }

    if (!lastRound) {
      throw new Error("工具循环未执行任何模型轮次");
    }

    return {
      finalText,
      finalMessages: currentMessages,
      allToolResults,
      rounds: Math.max(1, Math.min(params.maxRounds, allToolResults.length + 1)),
      lastRound
    };
  }
}
