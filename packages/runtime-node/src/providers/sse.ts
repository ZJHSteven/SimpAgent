/**
 * 本文件作用：
 * - 解析 fetch 返回的 SSE 文本流（Server-Sent Events）。
 * - 供 Chat Completions 流式、Responses 流式共用。
 *
 * 教学说明：
 * - SSE 本质是按行协议，不是“每次读到一块就是一个 JSON”。
 * - 因此这里先按行切分，再组装事件帧。
 */

export interface SseEventFrame {
  event?: string;
  data: string;
}

export async function* parseSse(response: Response): AsyncGenerator<SseEventFrame> {
  if (!response.body) {
    throw new Error("响应体为空，无法解析 SSE");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent: string | undefined;
  let dataLines: string[] = [];

  const flushFrame = (): SseEventFrame | null => {
    if (dataLines.length === 0) return null;
    const frame: SseEventFrame = {
      event: currentEvent,
      data: dataLines.join("\n")
    };
    currentEvent = undefined;
    dataLines = [];
    return frame;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line === "") {
        const frame = flushFrame();
        if (frame) yield frame;
      } else if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      const frame = flushFrame();
      if (frame) yield frame;
      break;
    }
  }
}

