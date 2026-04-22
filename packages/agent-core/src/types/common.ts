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
 *
 * 说明：
 * - 当前项目的所有“内部主键”都统一使用 UUID v7。
 * - 这里不再接受 prefix，因为 prefix + 递增数字会让 ID 变得可预测，
 *   不适合作为全局唯一主键。
 */
export interface IdGenerator {
  nextId(): SimpAgentId;
}

/**
 * 生成 UUID v7 的 ID 生成器。
 *
 * 这个生成器不区分 run/thread/message 等业务类型：
 * 业务类型应该由字段名表达，而不是塞进 ID 字符串本身。
 */
export class UuidV7IdGenerator implements IdGenerator {
  nextId(): SimpAgentId {
    return createUuidV7Id();
  }
}

/**
 * 生成一个新的 UUID v7 字符串。
 *
 * 这个函数适合在少量场景下直接调用，比如：
 * - 内置资源定义时生成一次性主键
 * - 无法持有 IdGenerator 实例的边界层兜底
 */
export function createUuidV7Id(): SimpAgentId {
  const bytes = new Uint8Array(16);
  fillRandomBytes(bytes);

  // UUID v7 的前 48 位是 Unix epoch 毫秒时间戳。
  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  // 第 7 个字节高 4 位固定为 7，表示 UUID version 7。
  const byte6 = bytes[6] ?? 0;
  bytes[6] = (byte6 & 0x0f) | 0x70;
  // 第 9 个字节高 2 位固定为 10，表示 RFC 4122 / RFC 9562 variant。
  const byte8 = bytes[8] ?? 0;
  bytes[8] = (byte8 & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

/**
 * 默认系统时钟实现。
 */
export const systemClock: RuntimeClock = {
  now: () => Date.now()
};

/**
 * 填充 16 字节随机数。
 *
 * 优先使用运行时自带的 Web Crypto，这样 Node、浏览器、Worker、Tauri 都能共用。
 * 如果当前环境没有 crypto，则退回到 Math.random 作为兼容兜底。
 */
function fillRandomBytes(bytes: Uint8Array): void {
  const crypto = globalThis.crypto;

  if (crypto !== undefined && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
    return;
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
}

/**
 * 把 16 字节 UUID 转成标准字符串格式。
 */
function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];

  for (const byte of bytes) {
    hex.push(byte.toString(16).padStart(2, "0"));
  }

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join("")
  ].join("-");
}
