/**
 * 本文件集中放置跨模块复用的基础类型。
 * 这些类型不绑定 Node、浏览器或 Tauri，因此可以在所有 runtime 中安全复用。
 */

export type SimpAgentId = string;

/**
 * JSON 基础值类型。
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * 递归 JSON 值定义。
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * 时钟抽象。
 * 目的：便于测试注入固定时间，避免依赖 Date.now() 的不稳定性。
 */
export interface RuntimeClock {
  now(): number;
}

/**
 * 统一 ID 生成器抽象。
 */
export interface IdGenerator {
  nextId(prefix: string): SimpAgentId;
}

/**
 * 递增序列 ID 生成器。
 * 输出形如：msg_1、msg_2 ...
 */
export class IncrementalIdGenerator implements IdGenerator {
  private nextNumber = 1;

  nextId(prefix: string): SimpAgentId {
    // 先读取当前计数，再自增，保证同一实例下 ID 单调递增。
    const value = `${prefix}_${this.nextNumber}`;
    this.nextNumber += 1;
    return value;
  }
}

/**
 * 默认系统时钟实现。
 */
export const systemClock: RuntimeClock = {
  now: () => Date.now()
};

