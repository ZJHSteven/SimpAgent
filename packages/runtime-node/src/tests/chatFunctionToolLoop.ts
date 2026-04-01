/**
 * 文件作用：
 * - 回归测试 OpenAI-compatible `chat_completions` + function calling 的两类关键兼容点。
 *
 * 教学说明：
 * 1. 某些兼容提供商（包括这次实测的 DeepSeek）会把一个 tool call 拆成多段流式事件：
 *    - 第一段只给 `id + function.name`
 *    - 后续段只给 `function.arguments`
 *    - 中间可能重复给 `index`，但不再重复 `id/name`
 *    这要求 provider 兼容层必须按槽位稳定累计，而不是每段都生成一个新的随机 toolCallId。
 *
 * 2. 当工具执行完毕后，下一轮继续请求模型时，消息列表里必须同时包含：
 *    - 上一轮 assistant 的 `tool_calls`
 *    - 与之对应的 `role=tool` 结果消息
 *    否则很多 OpenAI-compatible 提供商会直接拒绝请求。
 *
 * 这个测试不依赖真实网络，而是用 mock fetch + SSE 响应模拟 DeepSeek 类行为，
 * 确保本次修复以后不会再回退。
 */

import assert from "node:assert/strict";
import { AgentRoundExecutor, ToolLoopExecutor } from "@simpagent/core/runtime";
import type { JsonObject, ToolResult, UnifiedModelRequest } from "../types/index.js";
import { UnifiedProviderClient } from "../providers/index.js";

function createSseResponse(frames: Array<Record<string, unknown> | "[DONE]">): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        const payload = frame === "[DONE]" ? "[DONE]" : JSON.stringify(frame);
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream"
    }
  });
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const seenBodies: Array<Record<string, unknown>> = [];
  let fetchCount = 0;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1;
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    seenBodies.push(body);

    if (fetchCount === 1) {
      /**
       * 第一轮模拟 DeepSeek 风格的分片：
       * - 首片只有 id + name
       * - 后续只给 arguments 片段
       */
      return createSseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_deepseek_1",
                    function: {
                      name: "update_plan"
                    }
                  }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: "{\"plan\":[{\"step\":\"验证 DeepSeek 接入\",\"status\":\"in_progress\"}"
                    }
                  }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: ",{\"step\":\"输出最终结论\",\"status\":\"pending\"}]}"
                    }
                  }
                ]
              }
            }
          ]
        },
        "[DONE]"
      ]);
    }

    if (fetchCount === 2) {
      const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
      const assistantIndex = messages.findIndex(
        (message) => message.role === "assistant" && Array.isArray(message.tool_calls)
      );
      const toolIndex = messages.findIndex((message) => message.role === "tool");

      assert.ok(assistantIndex >= 0, "第二轮请求必须包含 assistant.tool_calls 消息");
      assert.ok(toolIndex > assistantIndex, "tool 结果消息必须位于 assistant.tool_calls 之后");

      const assistantMessage = messages[assistantIndex] as Record<string, unknown>;
      const toolCalls = assistantMessage.tool_calls as Array<Record<string, unknown>>;
      assert.equal(toolCalls.length, 1, "第二轮 assistant.tool_calls 应只有一个工具调用");
      assert.equal(toolCalls[0].id, "call_deepseek_1", "tool_call_id 应与第一轮保持一致");

      const fn = toolCalls[0].function as Record<string, unknown>;
      assert.equal(fn.name, "update_plan", "tool name 应保留第一轮的函数名");
      assert.deepEqual(
        JSON.parse(String(fn.arguments)),
        {
          plan: [
            { step: "验证 DeepSeek 接入", status: "in_progress" },
            { step: "输出最终结论", status: "pending" }
          ]
        },
        "assistant.tool_calls 里应携带完整的结构化参数"
      );

      const toolMessage = messages[toolIndex] as Record<string, unknown>;
      assert.equal(toolMessage.tool_call_id, "call_deepseek_1", "tool 结果必须回指同一个 tool_call_id");

      return createSseResponse([
        {
          choices: [
            {
              delta: {
                content: "测试通过，工具循环消息格式正确。"
              }
            }
          ]
        },
        "[DONE]"
      ]);
    }

    throw new Error(`测试期望最多 2 次 fetch，实际收到 ${fetchCount} 次`);
  }) as typeof fetch;

  try {
    const providerClient = new UnifiedProviderClient();
    const roundExecutor = new AgentRoundExecutor(providerClient);
    const loopExecutor = new ToolLoopExecutor();

    const initialRequest: UnifiedModelRequest = {
      vendor: "generic_openai_compat",
      apiMode: "chat_completions",
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com",
      apiKey: "test-key",
      stream: true,
      messages: [
        {
          role: "system",
          content: "你正在执行工具循环兼容性测试。"
        },
        {
          role: "user",
          content: "请调用 update_plan，然后输出最终结论。"
        }
      ]
    };

    const result = await loopExecutor.execute({
      initialRequest,
      roundExecutor,
      ctx: {
        runId: "run_test_chat_function",
        threadId: "thread_test_chat_function",
        nodeId: "node.test",
        agentId: "agent.test"
      },
      maxRounds: 3,
      onToolCalls: async ({ calls }) => {
        assert.equal(calls.length, 1, "第一轮应只检测到一个工具调用");
        assert.equal(calls[0].toolCallId, "call_deepseek_1", "分片累计后应保留原始 toolCallId");
        assert.equal(calls[0].toolName, "update_plan", "分片累计后应保留原始 toolName");
        assert.deepEqual(
          calls[0].argumentsJson,
          {
            plan: [
              { step: "验证 DeepSeek 接入", status: "in_progress" },
              { step: "输出最终结论", status: "pending" }
            ]
          },
          "分片累计后应得到完整 JSON 参数"
        );

        const toolResult: ToolResult = {
          toolCallId: calls[0].toolCallId,
          toolId: "builtin.update_plan",
          ok: true,
          output: {
            ok: true
          } as JsonObject,
          startedAt: "2026-04-01T00:00:00.000Z",
          finishedAt: "2026-04-01T00:00:00.010Z",
          durationMs: 10
        };

        return {
          toolRoleMessages: [
            {
              role: "tool",
              name: "update_plan",
              toolCallId: calls[0].toolCallId,
              content: JSON.stringify({ ok: true })
            }
          ],
          toolResults: [toolResult]
        };
      }
    });

    assert.equal(result.finalText, "测试通过，工具循环消息格式正确。");
    assert.equal(fetchCount, 2, "工具循环应正好触发两轮 provider 请求");
    assert.equal(seenBodies.length, 2, "应记录两轮请求体");

    console.log(
      "CHAT_FUNCTION_TOOL_LOOP_TEST_OK",
      JSON.stringify({
        rounds: result.rounds,
        finalText: result.finalText,
        fetchCount
      })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await main();
