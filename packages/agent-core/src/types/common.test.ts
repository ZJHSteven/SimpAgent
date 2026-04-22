/**
 * 本文件专门测试基础 ID 生成能力。
 *
 * 为什么单独放一组测试：
 * - ID 生成是整个 agent-core 的底层约定，失败会影响 thread、run、turn、message 等所有链路。
 * - 这里直接验证 UUID v7 的版本位和变体位，避免未来有人把实现改回递增字符串却没被发现。
 */
import { describe, expect, it } from "vitest";
import { createUuidV7Id, UuidV7IdGenerator } from "./common.js";

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("uuid v7 id generator", () => {
  it("createUuidV7Id 会返回符合 UUID v7 结构的字符串", () => {
    const id = createUuidV7Id();

    expect(id).toMatch(uuidV7Pattern);
  });

  it("UuidV7IdGenerator 每次都会生成新的 UUID v7", () => {
    const generator = new UuidV7IdGenerator();
    const first = generator.nextId();
    const second = generator.nextId();

    expect(first).toMatch(uuidV7Pattern);
    expect(second).toMatch(uuidV7Pattern);
    expect(second).not.toBe(first);
  });
});
