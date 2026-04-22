/**
 * 真 LLM smoke test。
 *
 * 这个文件专门验证“真实厂商 API + 流式 SSE”链路，而不是 mock。
 * 它的目标不是替代单元测试，而是补一层手工可触发的线上/真网回归：
 * 1) 非思考模型可以真实流式吐出 message_delta。
 * 2) 思考模型可以真实流式吐出 thinking_delta，并且同时仍然有 message_delta。
 *
 * 运行方式：
 * - `npm run test:smoke`
 * - 直接读取仓库根目录 `simpagent.toml`
 * - 需要在 TOML 里填写 `smokeChatModel` 和 `smokeReasoningModel`
 */
import { describe, expect, it } from "vitest";
import { sendChatCompletionsRequest, type ProviderStrategy } from "../index.js";
import type { AdapterStreamEvent } from "../types/api.js";
import { loadSmokeTestConfig } from "./smoke-config.js";

/**
 * 组装一个最小的 provider strategy。
 *
 * 这里保持和真实业务一样走 `deepseek-chat-completions` 适配器，
 * 这样 smoke 才能验证“真实 API 返回的 SSE 事件是否能被现有解析器正确消费”。
 */
function createStrategy(model: string, apiKey: string, baseUrl: string): ProviderStrategy {
  return {
    id: "smoke_provider",
    name: "deepseek-smoke",
    provider: "deepseek-chat-completions",
    baseUrl,
    apiKey,
    model
  };
}

/**
 * 发送一次真实流式请求，并把实时事件完整收集下来。
 *
 * 关键点：
 * - `onStreamEvent` 会在 SSE 分片到达时就被调用，这里顺手累积事件，验证“真流式”而不是一次性返回。
 * - `firstDeltaPromise` 用于确保 smoke test 真正看到了流式增量，而不是等到完整响应收完才出现内容。
 */
async function runRealStreamingSmoke(input: {
  readonly strategy: ProviderStrategy;
  readonly prompt: string;
}): Promise<{
  readonly response: Awaited<ReturnType<typeof sendChatCompletionsRequest>>;
  readonly events: readonly AdapterStreamEvent[];
}> {
  const events: AdapterStreamEvent[] = [];
  let resolveFirstDelta: (() => void) | undefined;

  const firstDeltaPromise = new Promise<void>((resolve) => {
    resolveFirstDelta = resolve;
  });

  const responsePromise = sendChatCompletionsRequest({
    adapterInput: {
      strategy: input.strategy,
      messages: [
        {
          id: "msg_smoke_user",
          role: "user",
          content: input.prompt
        }
      ],
      tools: [],
      stream: true
    },
    fetchFn: fetch,
    clock: {
      now: () => Date.now()
    },
    onStreamEvent: (event) => {
      events.push(event);

      if (
        resolveFirstDelta !== undefined &&
        (event.type === "message_delta" || event.type === "thinking_delta" || event.type === "tool_call_delta")
      ) {
        // 一旦真实 SSE 里拿到第一段增量，就立刻唤醒外层断言。
        resolveFirstDelta();
        resolveFirstDelta = undefined;
      }
    }
  });

  await firstDeltaPromise;
  const response = await responsePromise;

  return {
    response,
    events
  };
}

describe("真 LLM smoke test", () => {
  it("非思考模型会真实流式返回 message_delta", async () => {
    const smokeConfig = await loadSmokeTestConfig();

    const { response, events } = await runRealStreamingSmoke({
      strategy: createStrategy(smokeConfig.chatModel, smokeConfig.apiKey, smokeConfig.baseUrl),
      prompt: "请用一句非常简短的中文回答：1 + 1 等于几？"
    });

    const messageText = events
      .filter((event): event is Extract<AdapterStreamEvent, { type: "message_delta" }> => event.type === "message_delta")
      .map((event) => event.delta)
      .join("");

    expect(events.some((event) => event.type === "message_delta")).toBe(true);
    expect(messageText.length).toBeGreaterThan(0);
    expect(response.status).toBe(200);
    expect(response.firstTokenMs).toBeDefined();
    expect(response.events.some((event) => event.type === "done")).toBe(true);
  }, 120000);

  it("思考模型会同时流式返回 thinking_delta 和 message_delta", async () => {
    const smokeConfig = await loadSmokeTestConfig();

    const { response, events } = await runRealStreamingSmoke({
      strategy: createStrategy(smokeConfig.reasoningModel, smokeConfig.apiKey, smokeConfig.baseUrl),
      prompt: "请先简要思考，再用一句中文回答：为什么 7 比 5 大？"
    });

    const thinkingText = events
      .filter((event): event is Extract<AdapterStreamEvent, { type: "thinking_delta" }> => event.type === "thinking_delta")
      .map((event) => event.delta)
      .join("");
    const messageText = events
      .filter((event): event is Extract<AdapterStreamEvent, { type: "message_delta" }> => event.type === "message_delta")
      .map((event) => event.delta)
      .join("");

    expect(events.some((event) => event.type === "thinking_delta")).toBe(true);
    expect(thinkingText.length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "message_delta")).toBe(true);
    expect(messageText.length).toBeGreaterThan(0);
    expect(response.status).toBe(200);
    expect(response.firstTokenMs).toBeDefined();
    expect(response.events.some((event) => event.type === "done")).toBe(true);
  }, 120000);
});
