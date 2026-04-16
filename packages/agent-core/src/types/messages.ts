import type { JsonObject, JsonValue, SimpAgentId } from "./common.js";
import type { ToolCallRequest } from "./tools.js";

/**
 * SimpAgent 内部上下文消息格式。
 * 它刻意比厂商 API 稍宽：保留 id、selector、tags、thinking 等字段，发送前再由 adapter 转换。
 */

export type ContextRole =
  | "system"
  | "developer"
  | "user"
  | "assistant"
  | "tool"
  | "thinking";

export type ContextContentPart =
  | {
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly type: "image_url";
      readonly image_url: {
        readonly url: string;
        readonly detail?: "auto" | "low" | "high";
      };
    }
  | {
      readonly type: "file";
      readonly file: {
        readonly name?: string;
        readonly url?: string;
        readonly data?: string;
      };
    };

export type ContextContent = string | readonly ContextContentPart[];

export interface ContextSelector {
  readonly role?: ContextRole;
  readonly index?: number;
  readonly type?: string;
  readonly path?: readonly string[];
}

export interface ContextMessage {
  readonly id: SimpAgentId;
  readonly role: ContextRole;
  readonly content: ContextContent;
  readonly turnId?: SimpAgentId;
  readonly parentId?: SimpAgentId;
  readonly tags?: readonly string[];
  readonly selector?: ContextSelector;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly name?: string;
  readonly metadata?: JsonObject;
}

export function textOfContent(content: ContextContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function createTextMessage(input: {
  readonly id: SimpAgentId;
  readonly role: ContextRole;
  readonly content: string;
  readonly turnId?: SimpAgentId;
  readonly parentId?: SimpAgentId;
  readonly tags?: readonly string[];
  readonly selector?: ContextSelector;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly name?: string;
  readonly metadata?: JsonObject;
}): ContextMessage {
  return {
    id: input.id,
    role: input.role,
    content: input.content,
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.selector === undefined ? {} : { selector: input.selector }),
    ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
    ...(input.toolCalls === undefined ? {} : { toolCalls: input.toolCalls }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata })
  };
}

export function asJsonObject(value: JsonValue): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }

  throw new Error("期望 JSON object，但收到的值不是对象。");
}
