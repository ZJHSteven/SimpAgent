import type { AdapterStreamEvent } from "../types/api.js";

interface MutableToolDelta {
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

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
    const delta = choice.delta ?? {};

    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      events.push({ type: "thinking_delta", delta: delta.reasoning_content });
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      events.push({ type: "message_delta", delta: delta.content });
    }

    for (const toolCall of delta.tool_calls ?? []) {
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

export function parseSseText(text: string): AdapterStreamEvent[] {
  const events: AdapterStreamEvent[] = [];
  const blocks = text.split(/\r?\n\r?\n/);

  for (const block of blocks) {
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
      events.push(...parseSseText(`${part}\n\n`));
    }
  }

  buffer += decoder.decode();

  if (buffer.trim().length > 0) {
    events.push(...parseSseText(buffer));
  }

  return events;
}

