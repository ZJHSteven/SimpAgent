/**
 * 本文件加载 server 应用自己的默认 preset。
 *
 * 为什么 app 也保留一份完整 preset：
 * - `agent-core` 提供框架级默认 preset，保证所有 runtime 都有可启动的基础配置。
 * - `apps/server` 是一个具体产品入口，它可以复制核心 preset 后添加应用专属 agent/tool/prompt。
 * - 当前这份 app preset 先与 core preset 保持一致；以后 server 要增加默认内容，只改这里的 JSON 表文件即可。
 */
import {
  createPresetBundleFromTableRows,
  type PresetAgentNodeRow,
  type PresetBundle,
  type PresetEdgeRow,
  type PresetNodeRow,
  type PresetPromptUnitRow,
  type PresetProviderRuntimeConfig,
  type PresetProviderStrategyRow,
  type PresetToolNodeRow
} from "@simpagent/agent-core";
import agentNodeRows from "./presets/default/agent_nodes.json" with { type: "json" };
import edgeRows from "./presets/default/edges.json" with { type: "json" };
import nodeRows from "./presets/default/nodes.json" with { type: "json" };
import promptUnitRows from "./presets/default/prompt_units.json" with { type: "json" };
import providerStrategyRows from "./presets/default/provider_strategies.json" with { type: "json" };
import toolNodeRows from "./presets/default/tool_nodes.json" with { type: "json" };

/**
 * 加载 server 应用默认 preset。
 *
 * 输入：
 * - runtimeConfig: 当前运行环境的 provider/baseUrl/model。
 *
 * 输出：
 * - 可直接导入 SQLite 的 `PresetBundle`。
 *
 * 核心逻辑：
 * - 这里只把 app 自己的 JSON 表行交给核心加载器。
 * - provider 的真实连接信息仍在运行时覆盖，避免 preset 文件里写死本机模型服务。
 */
export function loadServerDefaultPreset(runtimeConfig: PresetProviderRuntimeConfig): PresetBundle {
  return createPresetBundleFromTableRows(
    {
      nodes: nodeRows as readonly PresetNodeRow[],
      edges: edgeRows as readonly PresetEdgeRow[],
      agent_nodes: agentNodeRows as readonly PresetAgentNodeRow[],
      tool_nodes: toolNodeRows as readonly PresetToolNodeRow[],
      prompt_units: promptUnitRows as readonly PresetPromptUnitRow[],
      provider_strategies: providerStrategyRows as readonly PresetProviderStrategyRow[]
    },
    runtimeConfig
  );
}
