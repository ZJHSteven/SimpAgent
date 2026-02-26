/**
 * 本文件作用：
 * - 执行多轮“模型 -> 工具 -> 模型”的循环（直到无工具调用或达到上限）。
 *
 * 教学说明：
 * - 这是运行时层的能力，不属于 Provider 兼容层；
 * - Provider 层只负责把协议事件归一化，工具循环由 runtime 决策与执行。
 */

import type {
  JsonValue,
  ToolResult,
  UnifiedMessage,
  UnifiedModelRequest
} from "../types/index.js";
import type { AgentRoundExecuteResult, AgentRoundExecutor, AgentRoundExecutorTraceContext } from "./agentRoundExecutor.js";

export interface ToolLoopExecuteContext extends AgentRoundExecutorTraceContext {}

export interface ToolLoopExecuteParams {
  initialRequest: UnifiedModelRequest;
  roundExecutor: AgentRoundExecutor;
  ctx: ToolLoopExecuteContext;
  maxRounds: number;
  onToolCalls: (args: {
    roundIndex: number;
    calls: AgentRoundExecuteResult["toolCalls"];
  }) => Promise<{
    toolRoleMessages: UnifiedMessage[];
    toolResults: ToolResult[];
  }>;
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

      if (!round.toolCalls.length) {
        break;
      }

      const toolOutput = await params.onToolCalls({
        roundIndex,
        calls: round.toolCalls
      });
      allToolResults.push(...toolOutput.toolResults);
      currentMessages = [...currentMessages, ...toolOutput.toolRoleMessages];
      currentReq = { ...currentReq, messages: currentMessages };
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

