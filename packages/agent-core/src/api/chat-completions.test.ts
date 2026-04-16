import { describe, expect, it, vi } from "vitest";
import {
  assembleToolCalls,
  buildChatCompletionsRequest,
  parseSseText,
  sendChatCompletionsRequest
} from "../index.js";

const strategy = {
  id: "provider_1",
  name: "DeepSeek",
  provider: "deepseek-chat-completions" as const,
  baseUrl: "https://api.deepseek.com",
  apiKey: "test-key",
  model: "deepseek-chat",
  extra: {
    temperature: 0.2,
    parallel_tool_calls: true
  }
};

describe("Chat Completions adapter", () => {
  it("构造 OpenAI-compatible 请求体时会过滤内部 thinking 消息并保留 extra", () => {
    const request = buildChatCompletionsRequest({
      strategy,
      messages: [
        { id: "m1", role: "system", content: "你是助手" },
        { id: "m2", role: "thinking", content: "内部思考" },
        { id: "m3", role: "user", content: "你好" }
      ],
      tools: [
        {
          id: "tool_1",
          name: "read_file",
          description: "读取文件",
          parameters: { type: "object", properties: {}, additionalProperties: false }
        }
      ],
      stream: true
    });

    expect(request.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(request.body.model).toBe("deepseek-chat");
    expect(request.body.temperature).toBe(0.2);
    expect(request.body.messages).toEqual([
      { role: "system", content: "你是助手" },
      { role: "user", content: "你好" }
    ]);
    expect(request.body.tools).toHaveLength(1);
  });

  it("解析 DeepSeek reasoning_content 和 tool call delta", () => {
    const events = parseSseText(
      [
        'data: {"choices":[{"delta":{"reasoning_content":"想","content":"答","tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\""}}]}}]}',
        "",
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"a.txt\\"}"}}]}}]}',
        "",
        "data: [DONE]",
        "",
        ""
      ].join("\n")
    );

    expect(events).toContainEqual({ type: "thinking_delta", delta: "想" });
    expect(events).toContainEqual({ type: "message_delta", delta: "答" });
    expect(assembleToolCalls(events)).toEqual([
      {
        id: "call_1",
        name: "read_file",
        argumentsText: "{\"path\":\"a.txt\"}"
      }
    ]);
  });

  it("发送请求时支持 mock fetch 非流式响应", async () => {
    const fetchFn = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "完成" } }]
        }),
        { status: 200, headers: { "x-request-id": "req_1" } }
      );
    });

    const response = await sendChatCompletionsRequest({
      adapterInput: {
        strategy,
        messages: [{ id: "m1", role: "user", content: "测试" }],
        tools: [],
        stream: false
      },
      fetchFn,
      clock: { now: () => 100 }
    });

    expect(response.requestId).toBe("req_1");
    expect(response.events).toContainEqual({ type: "message_delta", delta: "完成" });
  });
});

