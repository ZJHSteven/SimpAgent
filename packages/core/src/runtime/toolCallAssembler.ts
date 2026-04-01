/**
 * 本文件作用：
 * - 在流式模型输出过程中，增量组装 tool call 参数。
 *
 * 教学说明：
 * - Chat/Responses 的流式 tool call 参数经常是分片到达（argumentsDelta）；
 * - 不能在收到第一片时就执行工具，必须先组装成完整 JSON。
 */

import type { JsonObject, UnifiedModelStreamEvent } from "../types/index.js";

interface ToolCallBuffer {
  toolCallId: string;
  toolName: string;
  argumentsText: string;
  argumentsJson?: JsonObject;
}

/**
 * 尝试把累计的 arguments 文本解析成 JSON 对象。
 * 说明：
 * - 流式 tool call 很容易在中途还是半截 JSON，因此失败时返回 `null` 而不是抛异常；
 * - 只有对象才被接受，因为工具参数约定是 key-value 结构。
 */
function safeParseObject(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
    return null;
  } catch {
    return null;
  }
}

export class ToolCallAssembler {
  private readonly map = new Map<string, ToolCallBuffer>();

  /**
   * 推入一片 tool_call 增量。
   * 优先级：
   * 1. 有 `argumentsJson` 时优先信任 provider 给出的结构化参数；
   * 2. 否则持续累计 `argumentsDelta`；
   * 3. 每次 push 后都尝试解析一次，尽早知道 JSON 是否已经完整。
   */
  push(event: Extract<UnifiedModelStreamEvent, { type: "tool_call_request" }>): {
    toolCallId: string;
    toolName: string;
    parsedNow: boolean;
    jsonReady: boolean;
  } {
    const prev = this.map.get(event.toolCallId) ?? {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      argumentsText: ""
    };
    prev.toolName = event.toolName || prev.toolName;
    if (typeof event.argumentsDelta === "string") {
      // 这里一定是追加，而不是覆盖；否则会把之前已经收到的 JSON 片段冲掉。
      prev.argumentsText += event.argumentsDelta;
    }
    if (event.argumentsJson && typeof event.argumentsJson === "object") {
      // provider 已经替我们解析好参数时，直接采用结构化对象。
      prev.argumentsJson = event.argumentsJson;
    } else if (!prev.argumentsJson && prev.argumentsText.trim()) {
      const parsed = safeParseObject(prev.argumentsText);
      if (parsed) prev.argumentsJson = parsed;
    }
    this.map.set(event.toolCallId, prev);
    return {
      toolCallId: prev.toolCallId,
      toolName: prev.toolName,
      parsedNow: Boolean(prev.argumentsJson),
      jsonReady: Boolean(prev.argumentsJson)
    };
  }

  /**
   * 输出当前所有观察到的 tool call。
   * 兜底策略：
   * - 优先使用已缓存的 `argumentsJson`；
   * - 否则尝试解析累计文本；
   * - 仍失败时退回空对象 `{}`，把“不完整参数”的报错留给更上层做 schema 校验。
   */
  finalize(): Array<{ toolCallId: string; toolName: string; argumentsJson: JsonObject }> {
    const result: Array<{ toolCallId: string; toolName: string; argumentsJson: JsonObject }> = [];
    for (const buf of this.map.values()) {
      const parsed = buf.argumentsJson ?? safeParseObject(buf.argumentsText) ?? {};
      result.push({
        toolCallId: buf.toolCallId,
        toolName: buf.toolName,
        argumentsJson: parsed
      });
    }
    return result;
  }

  /**
   * 生成一份适合调试展示的快照。
   * 用途：
   * - 前端查看“某个 tool_call 已经累计了多少文本”；
   * - 排查 provider 是否一直只返回半截参数。
   */
  snapshot(): Array<{ toolCallId: string; toolName: string; argumentsTextPreview: string; jsonReady: boolean }> {
    return [...this.map.values()].map((buf) => ({
      toolCallId: buf.toolCallId,
      toolName: buf.toolName,
      argumentsTextPreview: buf.argumentsText.slice(0, 300),
      jsonReady: Boolean(buf.argumentsJson)
    }));
  }
}
