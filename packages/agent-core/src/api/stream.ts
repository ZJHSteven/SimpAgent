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
 * 逐个发送解析出来的 adapter 事件。
 *
 * 输入：
 * - events: 当前 SSE block 解析出的事件数组，通常是 1 个，也可能同时包含正文、思考和工具分片。
 * - onEvent: 可选的实时回调，上层 agent loop 会用它把 token 立刻转发给 CLI 或 SSE 客户端。
 *
 * 输出：
 * - 返回同一批 events，方便调用方继续追加到完整历史列表中。
 *
 * 核心逻辑：
 * - 即使上层没有传 onEvent，也照常返回事件数组，保持原有“完整收集后返回”的能力。
 * - 如果传了 onEvent，则按解析顺序逐个 await，保证终端打印、SSE 广播和 trace 收集顺序一致。
 */
async function publishEvents(
  events: readonly AdapterStreamEvent[],
  onEvent: ((event: AdapterStreamEvent) => void | Promise<void>) | undefined
): Promise<readonly AdapterStreamEvent[]> {
  for (const event of events) {
    // 这里逐个 await，而不是 Promise.all，是为了保留 token 顺序；流式输出最怕乱序。
    await onEvent?.(event);
  }

  return events;
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
export async function readSseStream(
  response: Response,
  onEvent?: (event: AdapterStreamEvent) => void | Promise<void>
): Promise<readonly AdapterStreamEvent[]> {
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
      const parsedEvents = await publishEvents(parseSseText(`${part}\n\n`), onEvent);
      events.push(...parsedEvents);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim().length > 0) {
    const parsedEvents = await publishEvents(parseSseText(buffer), onEvent);
    events.push(...parsedEvents);
  }

  return events;
}
