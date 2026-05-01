/**
 * 默认 preset 加载器测试。
 *
 * 测试目标：
 * - 确认核心包内置 preset 是从 JSON 表行加载，而不是 TS 代码临时拼装。
 * - 确认运行时 provider/baseUrl/model 会覆盖 JSON 占位值。
 * - 确认默认三 agent、四工具的基础图谱没有被误删。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_A_ID,
  DEFAULT_AGENT_B_ID,
  DEFAULT_AGENT_C_ID,
  DEFAULT_PROVIDER_STRATEGY_ID,
  loadCoreDefaultPreset
} from "./default-preset.js";

describe("loadCoreDefaultPreset", () => {
  it("从核心 JSON preset 加载基础图谱，并覆盖 provider 运行时配置", () => {
    const preset = loadCoreDefaultPreset({
      provider: "deepseek-chat-completions",
      baseUrl: "https://example.test",
      model: "test-model"
    });

    expect(preset.agent_nodes.map((row) => row.node_id)).toEqual([
      DEFAULT_AGENT_A_ID,
      DEFAULT_AGENT_B_ID,
      DEFAULT_AGENT_C_ID
    ]);
    expect(preset.tool_nodes.map((row) => row.tool_name).sort()).toEqual([
      "edit_file",
      "handoff",
      "read_file",
      "shell_command"
    ]);
    expect(preset.provider_strategies).toEqual([
      expect.objectContaining({
        node_id: DEFAULT_PROVIDER_STRATEGY_ID,
        provider: "deepseek-chat-completions",
        base_url: "https://example.test",
        model: "test-model"
      })
    ]);
    expect(preset.edges.filter((edge) => edge.edge_type === "discoverable")).toHaveLength(4);
    expect(preset.edges.filter((edge) => edge.edge_type === "tool_access")).toHaveLength(12);
  });
});
