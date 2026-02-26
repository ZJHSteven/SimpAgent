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
      prev.argumentsText += event.argumentsDelta;
    }
    if (event.argumentsJson && typeof event.argumentsJson === "object") {
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

  snapshot(): Array<{ toolCallId: string; toolName: string; argumentsTextPreview: string; jsonReady: boolean }> {
    return [...this.map.values()].map((buf) => ({
      toolCallId: buf.toolCallId,
      toolName: buf.toolName,
      argumentsTextPreview: buf.argumentsText.slice(0, 300),
      jsonReady: Boolean(buf.argumentsJson)
    }));
  }
}

