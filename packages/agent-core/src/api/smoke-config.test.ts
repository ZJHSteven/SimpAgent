/**
 * smoke-config 单元测试。
 *
 * 这组测试不依赖真实 API，只检查：
 * 1) 能否从 TOML 文件读出 smoke 专用模型名。
 * 2) 缺少 smoke 字段时会给出明确错误。
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadSmokeTestConfig } from "./smoke-config.js";

describe("smoke-config", () => {
  it("会从 simpagent.toml 风格文件读取 smoke 配置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "simpagent-smoke-"));
    const path = join(dir, "simpagent.toml");

    await writeFile(
      path,
      [
        'provider = "deepseek"',
        'baseUrl = "https://api.deepseek.com"',
        'apiKey = "sk-test"',
        'model = "deepseek-chat"',
        'smokeChatModel = "deepseek-chat"',
        'smokeReasoningModel = "deepseek-reasoner"',
        'smokeBaseUrl = "https://api.deepseek.com"',
        ""
      ].join("\n"),
      "utf8"
    );

    await expect(loadSmokeTestConfig(path)).resolves.toEqual({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      chatModel: "deepseek-chat",
      reasoningModel: "deepseek-reasoner"
    });
  });

  it("缺少 smokeChatModel 或 smokeReasoningModel 时会明确报错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "simpagent-smoke-"));
    const path = join(dir, "simpagent.toml");

    await writeFile(
      path,
      [
        'provider = "deepseek"',
        'baseUrl = "https://api.deepseek.com"',
        'apiKey = "sk-test"',
        'model = "deepseek-chat"',
        ""
      ].join("\n"),
      "utf8"
    );

    await expect(loadSmokeTestConfig(path)).rejects.toThrow(
      "simpagent.toml 必须提供 baseUrl、apiKey、smokeChatModel、smokeReasoningModel"
    );
  });
});
