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

/**
 * 多模态内容分片。
 * 这里保留了 text / image_url / file 三种常见形态，便于后续映射到不同厂商协议。
 */
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

/**
 * selector 用于“上下文裁剪 / 精确定位”场景，便于做回溯、fork 或 message targeting。
 */
export interface ContextSelector {
  readonly role?: ContextRole;
  readonly index?: number;
  readonly type?: string;
  readonly path?: readonly string[];
}

/**
 * SimpAgent 的统一消息结构。
 * 说明：大量字段为可选，目的是减少不同消息角色之间的结构浪费。
 */
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

/**
 * 从多模态 content 中抽取纯文本（仅拼接 text 分片）。
 */
export function textOfContent(content: ContextContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * 创建文本消息的工厂函数。
 * 用条件展开语法避免把 undefined 字段写入结果对象，保持 payload 干净。
 */
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

/**
 * 运行时断言：仅当 value 是 JSON 对象时返回，否则抛错。
 * 常用于边界层校验外部输入。
 */
export function asJsonObject(value: JsonValue): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }

  throw new Error("期望 JSON object，但收到的值不是对象。");
}
