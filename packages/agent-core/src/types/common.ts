/**
 * 本文件集中放置跨模块复用的基础类型。
 * 这些类型不绑定 Node、浏览器或 Tauri，因此可以在所有 runtime 中安全复用。
 */

export type SimpAgentId = string;

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface RuntimeClock {
  now(): number;
}

export interface IdGenerator {
  nextId(prefix: string): SimpAgentId;
}

export class IncrementalIdGenerator implements IdGenerator {
  private nextNumber = 1;

  nextId(prefix: string): SimpAgentId {
    const value = `${prefix}_${this.nextNumber}`;
    this.nextNumber += 1;
    return value;
  }
}

export const systemClock: RuntimeClock = {
  now: () => Date.now()
};

