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
  /**
   * 执行“模型 -> 工具 -> 模型”的多轮循环。
   *
   * 输入：
   * - `initialRequest`：第一轮发给模型的统一请求；
   * - `roundExecutor`：只负责“一轮模型调用”的执行器；
   * - `detectToolCalls`：当 provider 没有原生 tool_call 时，从文本协议中补检测；
   * - `onToolCalls`：真正执行工具，并把结果转成 tool role messages；
   *
   * 输出：
   * - 返回循环结束后的最终文本、最终 messages、全部工具结果，以及最后一轮模型响应。
   *
   * 核心逻辑：
   * 1. 先跑一轮模型；
   * 2. 收集原生 tool call，必要时再走文本协议解析；
   * 3. 如果没有工具调用，循环结束；
   * 4. 如果有工具调用，就执行工具、回填 tool message，再进入下一轮；
   * 5. 某些工具（例如 handoff）允许在执行后直接终止本轮 agent。
   */
  async execute(params: ToolLoopExecuteParams): Promise<ToolLoopExecuteResult> {
    // `currentReq` 表示“下一轮真正要发给模型的请求体”。
    let currentReq = { ...params.initialRequest };
    // `currentMessages` 是循环过程中不断追加 tool role message 的消息列表。
    let currentMessages = [...(params.initialRequest.messages ?? [])];
    // `finalText` 始终保留最近一轮模型输出的文本，便于最终摘要展示。
    let finalText = "";
    // `allToolResults` 累积整次循环里所有工具执行结果，供 trace / side effect / 审计使用。
    const allToolResults: ToolResult[] = [];
    // `lastRound` 用来保证最终能拿到最后一轮模型的原始结果。
    let lastRound: AgentRoundExecuteResult | null = null;

    for (let roundIndex = 0; roundIndex < Math.max(1, params.maxRounds); roundIndex++) {
      // 每轮都强制打开 stream，让上层可以持续拿到统一流式事件。
      const round = await params.roundExecutor.executeRound(
        { ...currentReq, messages: currentMessages, stream: true },
        params.ctx
      );
      lastRound = round;
      // 如果本轮没有文本，保留上一轮文本，避免被空字符串覆盖。
      finalText = round.text || finalText;

      // 优先信任 provider 原生 tool call，因为这是结构最完整、歧义最小的来源。
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

      // 没有工具调用，说明模型这一轮已经进入“自然语言收束”阶段，可以结束循环。
      if (!detectedCalls.length) {
        break;
      }

      // 真正执行工具，并拿到需要回填给模型的 tool role messages。
      const toolOutput = await params.onToolCalls({
        roundIndex,
        calls: detectedCalls
      });
      allToolResults.push(...toolOutput.toolResults);
      /**
       * 对 chat/function 这类原生工具协议，下一轮发回 provider 时必须同时带上：
       * 1. assistant 的 `tool_calls`
       * 2. 随后的 `role=tool` 结果消息
       *
       * 否则很多 OpenAI-compatible provider 会报：
       * “tool 消息没有对应的前置 tool_calls”。
       */
      const assistantToolCallMessage: UnifiedMessage[] =
        detectedCallsFromProvider.length > 0
          ? [
              {
                role: "assistant",
                content: round.text || "",
                toolCalls: detectedCallsFromProvider.map((call) => ({
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  argumentsJson: call.argumentsJson
                }))
              }
            ]
          : [];
      // 下一轮的上下文 = 原始 messages + assistant tool_calls + 本轮工具结果消息。
      currentMessages = [...currentMessages, ...assistantToolCallMessage, ...toolOutput.toolRoleMessages];
      currentReq = { ...currentReq, messages: currentMessages };
      // 某些工具本身意味着“当前 agent 应让出控制权”，这时不再继续追问模型。
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
      // 首版 rounds 仍采用“工具结果条数 + 1”的近似值，便于前端快速显示。
      // 注意：
      // - 若后续出现“一轮里多个工具调用”或“提前终止”的更复杂统计需求，
      //   这里可以改成直接累计 roundIndex。
      rounds: Math.max(1, Math.min(params.maxRounds, allToolResults.length + 1)),
      lastRound
    };
  }
}
