/**
 * 本文件负责把厂商返回的 SSE 文本流解析为统一 AdapterStreamEvent 事件。
 * 关键点：
 * 1) DeepSeek/OpenAI-compatible 的增量字段并不完全一致，这里做兼容归一。
 * 2) 工具调用是“分片到达”的，需要保留 index 与 arguments 增量。
 */
import type { AdapterStreamEvent } from "../types/api.js";

interface MutableToolDelta {
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

/**
 * 解析单个 data payload（不含 "data:" 前缀）。
 */
function parseChunkPayload(payload: string): AdapterStreamEvent[] {
  if (payload === "[DONE]") {
    return [{ type: "done" }];
  }

  const parsed = JSON.parse(payload) as {
    choices?: Array<{
      delta?: {
        content?: string;
        reasoning_content?: string;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        }>;
      };
    }>;
  };

  const events: AdapterStreamEvent[] = [];

  for (const choice of parsed.choices ?? []) {
    // 每个 choice 里拿增量对象，缺省时回退为空对象，避免大量可选链分支。
    const delta = choice.delta ?? {};

    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      events.push({ type: "thinking_delta", delta: delta.reasoning_content });
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      events.push({ type: "message_delta", delta: delta.content });
    }

    for (const toolCall of delta.tool_calls ?? []) {
      // 这里先组装可变对象，最后一次性 spread 到事件，避免写出大量 undefined 字段。
      const mutable: MutableToolDelta = {};

      if (toolCall.id !== undefined) {
        mutable.id = toolCall.id;
      }

      if (toolCall.function?.name !== undefined) {
        mutable.name = toolCall.function.name;
      }

      if (toolCall.function?.arguments !== undefined) {
        mutable.argumentsDelta = toolCall.function.arguments;
      }

      events.push({
        type: "tool_call_delta",
        index: toolCall.index ?? 0,
        ...mutable
      });
    }
  }

  return events;
}

/**
 * 解析完整 SSE 文本（可包含多个 event block）。
 */
export function parseSseText(text: string): AdapterStreamEvent[] {
  const events: AdapterStreamEvent[] = [];
  const blocks = text.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    // 一个 block 可能有多行 data，需要拼接后再做 JSON 解析。
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());

    if (dataLines.length === 0) {
      continue;
    }

    events.push(...parseChunkPayload(dataLines.join("\n")));
  }

  return events;
}

/**
 * 从 Response.body 流式读取并持续解析 SSE。
 * 做法：
 * - 按双换行切 block
 * - 保留最后一个不完整块到 buffer，等待下一批字节
 */
export async function readSseStream(response: Response): Promise<readonly AdapterStreamEvent[]> {
  if (response.body === null) {
    return [];
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AdapterStreamEvent[] = [];

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      // parseSseText 期望完整 block，这里补上分隔换行。
      events.push(...parseSseText(`${part}\n\n`));
    }
  }

  buffer += decoder.decode();

  if (buffer.trim().length > 0) {
    events.push(...parseSseText(buffer));
  }

  return events;
}

