/**
 * 本文件定义 SimpAgent 的 preset JSON 结构。
 *
 * 设计目标：
 * - preset 是“按 SQLite 表拆开的 JSON”，字段名尽量和数据库列名一一对应。
 * - 这样用户可以直接人工检查 JSON，也可以 reset SQLite 后重新导入。
 * - 本文件只放跨 runtime 的类型和轻量校验，不绑定 Node 文件系统。
 */
import type { JsonObject } from "../types/common.js";

export interface PresetNodeRow {
  readonly id: string;
  readonly node_type: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly enabled: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly metadata_json: string | null;
}

export interface PresetEdgeRow {
  readonly id: string;
  readonly source_node_id: string;
  readonly target_node_id: string;
  readonly edge_type: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly enabled: number;
  readonly condition_json: string | null;
  readonly metadata_json: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface PresetAgentNodeRow {
  readonly node_id: string;
  readonly prompt_binding_json: string;
  readonly tool_policy_json: string | null;
  readonly provider_strategy_node_id: string | null;
  readonly memory_policy_json: string | null;
}

export interface PresetToolNodeRow {
  readonly node_id: string;
  readonly tool_name: string;
  readonly description: string;
  readonly parameters_json: string;
  readonly executor_kind: string;
  readonly approval_policy: string;
  readonly config_json: string | null;
}

export interface PresetPromptUnitRow {
  readonly node_id: string;
  readonly role: string;
  readonly content_template: string;
  readonly variables_json: string | null;
}

export interface PresetProviderStrategyRow {
  readonly node_id: string;
  readonly provider: string;
  readonly base_url: string;
  readonly model: string;
  readonly strategy_json: string | null;
  readonly parameters_json: string | null;
}

export interface PresetBundle {
  readonly nodes: readonly PresetNodeRow[];
  readonly edges: readonly PresetEdgeRow[];
  readonly agent_nodes: readonly PresetAgentNodeRow[];
  readonly tool_nodes: readonly PresetToolNodeRow[];
  readonly prompt_units: readonly PresetPromptUnitRow[];
  readonly provider_strategies: readonly PresetProviderStrategyRow[];
}

/**
 * prompt binding 的第一版结构。
 *
 * 说明：
 * - `order` 是固定顺序，不是优先级比较。
 * - `kind=prompt_unit` 引用已有 prompt unit node。
 * - `history` / `current_user_input` 是运行时占位，不需要 target_node_id。
 */
export interface PromptBindingDefinition extends JsonObject {
  readonly kind: "prompt_unit" | "history" | "current_user_input" | "runtime_variable";
  readonly order: number;
  readonly enabled?: boolean;
  readonly target_node_id?: string;
  readonly variable_name?: string;
  readonly role?: string;
}

/**
 * handoff 工具第一版参数。
 *
 * context_selector 避免把内部 message UUID 暴露给模型：
 * - none：不带历史上下文。
 * - latest_n：带最近 n 条消息。
 * - full_branch：带当前 conversation 的主分支消息。
 * - manual_markdown：模型自己写一段上下文说明。
 */
export interface HandoffToolArguments extends JsonObject {
  readonly target_node_id: string;
  readonly input_markdown: string;
  readonly context_selector:
    | { readonly mode: "none" }
    | { readonly mode: "latest_n"; readonly count: number }
    | { readonly mode: "full_branch" }
    | { readonly mode: "manual_markdown"; readonly markdown: string };
  readonly return_mode?: "return_to_caller" | "transfer";
}

/**
 * 解析 JSON 字符串为对象数组。
 *
 * 用途：
 * - preset / prompt compiler 需要读取 SQLite 中保存的 JSON 配置。
 * - 出错时直接抛出，避免坏 preset 静默进入运行期。
 */
export function parseJsonArray<T>(text: string): T[] {
  const parsed = JSON.parse(text) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("期望 JSON array。");
  }

  return parsed as T[];
}
