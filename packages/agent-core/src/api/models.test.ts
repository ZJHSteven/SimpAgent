/**
 * 模型列表 API 测试。
 *
 * 这里不依赖真实网络，只验证：
 * - 是否会向 `/models` 发出请求
 * - 是否会带上鉴权头
 * - 是否能把标准模型列表返回值正确解析出来
 */
import { describe, expect, it, vi } from "vitest";
import { listProviderModels } from "./models.js";

describe("model list adapter", () => {
  it("会从 provider 的 /models 端点读取并标准化模型列表", async () => {
    const fetchFn = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe("https://api.deepseek.com/models");
      expect(init.method).toBe("GET");
      expect(init.headers).toMatchObject({
        authorization: "Bearer test-key"
      });

      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "deepseek-chat",
              object: "model",
              owned_by: "deepseek"
            },
            {
              id: "deepseek-reasoner",
              object: "model",
              owned_by: "deepseek"
            }
          ]
        }),
        { status: 200 }
      );
    });

    const result = await listProviderModels({
      strategy: {
        id: "provider_1",
        name: "DeepSeek",
        provider: "deepseek-chat-completions",
        baseUrl: "https://api.deepseek.com",
        apiKey: "test-key",
        model: "deepseek-chat"
      },
      fetchFn
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result).toEqual({
      object: "list",
      data: [
        {
          id: "deepseek-chat",
          object: "model",
          owned_by: "deepseek"
        },
        {
          id: "deepseek-reasoner",
          object: "model",
          owned_by: "deepseek"
        }
      ]
    });
  });

  it("响应格式不正确时会抛出明确错误", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));

    await expect(
      listProviderModels({
        strategy: {
          id: "provider_1",
          name: "DeepSeek",
          provider: "deepseek-chat-completions",
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          model: "deepseek-chat"
        },
        fetchFn
      })
    ).rejects.toThrow("模型列表响应格式不正确");
  });
});
