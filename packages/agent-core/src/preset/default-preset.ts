/**
 * 本文件是内置默认 preset 的“轻量加载器”。
 *
 * 重要边界：
 * - 真正的 preset 数据保存在同目录的 `builtin-default/*.json` 文件里。
 * - 本文件只做三件薄逻辑：复制 JSON 行、填入运行时 provider 配置、返回 `PresetBundle`。
 * - 这样 preset 仍然是可以被人直接审查、复制、分发、重置的配置资产，而不是 TS 代码一点点拼出来的对象。
 */
import type { ApiProviderKind } from "../types/api.js";
import type {
  PresetAgentNodeRow,
  PresetBundle,
  PresetEdgeRow,
  PresetNodeRow,
  PresetPromptUnitRow,
  PresetProviderStrategyRow,
  PresetToolNodeRow
} from "./preset.js";
import agentNodeRows from "./builtin-default/agent_nodes.json" with { type: "json" };
import edgeRows from "./builtin-default/edges.json" with { type: "json" };
import nodeRows from "./builtin-default/nodes.json" with { type: "json" };
import promptUnitRows from "./builtin-default/prompt_units.json" with { type: "json" };
import providerStrategyRows from "./builtin-default/provider_strategies.json" with { type: "json" };
import toolNodeRows from "./builtin-default/tool_nodes.json" with { type: "json" };

export const DEFAULT_AGENT_A_ID = "00000000-0000-7000-8000-000000000201";
export const DEFAULT_AGENT_B_ID = "00000000-0000-7000-8000-000000000202";
export const DEFAULT_AGENT_C_ID = "00000000-0000-7000-8000-000000000203";
export const DEFAULT_PROVIDER_STRATEGY_ID = "00000000-0000-7000-8000-000000000301";

export interface PresetProviderRuntimeConfig {
  readonly provider: ApiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
}

export interface PresetTableRows {
  readonly nodes: readonly PresetNodeRow[];
  readonly edges: readonly PresetEdgeRow[];
  readonly agent_nodes: readonly PresetAgentNodeRow[];
  readonly tool_nodes: readonly PresetToolNodeRow[];
  readonly prompt_units: readonly PresetPromptUnitRow[];
  readonly provider_strategies: readonly PresetProviderStrategyRow[];
}

/**
 * 复制一组 JSON 行。
 *
 * 为什么要复制：
 * - JSON import 在模块加载后是共享对象。
 * - 调用方拿到 preset 后可能会为了测试或应用级覆盖做修改，所以这里返回新对象，避免污染模块级资产。
 */
function cloneRows<T extends object>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

/**
 * 把按表 JSON 行组装成完整 `PresetBundle`。
 *
 * 输入：
 * - rows: 每张 SQLite 定义表对应的一组 JSON 行。
 * - runtimeConfig: 当前运行环境的 provider/baseUrl/model。
 *
 * 输出：
 * - 可直接交给 `SqliteTraceStore.importPreset()` 的完整 preset。
 *
 * 核心逻辑：
 * - preset 文件里的 provider strategy 只保存占位值。
 * - 启动时再把 `simpagent.toml` 中的真实 provider 参数覆盖进去，避免把本机配置写死到 preset 资产里。
 */
export function createPresetBundleFromTableRows(
  rows: PresetTableRows,
  runtimeConfig: PresetProviderRuntimeConfig
): PresetBundle {
  return {
    nodes: cloneRows(rows.nodes),
    edges: cloneRows(rows.edges),
    agent_nodes: cloneRows(rows.agent_nodes),
    tool_nodes: cloneRows(rows.tool_nodes),
    prompt_units: cloneRows(rows.prompt_units),
    provider_strategies: rows.provider_strategies.map((row) =>
      row.node_id === DEFAULT_PROVIDER_STRATEGY_ID
        ? {
            ...row,
            provider: runtimeConfig.provider,
            base_url: runtimeConfig.baseUrl,
            model: runtimeConfig.model
          }
        : { ...row }
    )
  };
}

/**
 * 加载核心包内置默认 preset。
 *
 * 这是框架层自带的基础版本；具体 app 如果要扩展默认 agent/tool/prompt，
 * 可以复制同样的 JSON 表文件，再调用 `createPresetBundleFromTableRows()` 生成自己的应用级 preset。
 */
export function loadCoreDefaultPreset(runtimeConfig: PresetProviderRuntimeConfig): PresetBundle {
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
