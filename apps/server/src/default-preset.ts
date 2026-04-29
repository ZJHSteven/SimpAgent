/**
 * 本文件保存 server 随应用分发的默认 preset。
 *
 * 重要边界：
 * - preset 资产可以放在 server，因为它是“这个应用默认带什么配置”。
 * - preset 导入、导出、reset 的通用能力必须在 agent-core，不能写死在 server。
 * - 字段名保持 SQLite 表列名风格，方便和导出的 JSON 直接对照。
 */
import {
  BUILTIN_TOOL_EDIT_FILE_ID,
  BUILTIN_TOOL_HANDOFF_ID,
  BUILTIN_TOOL_READ_FILE_ID,
  BUILTIN_TOOL_SHELL_COMMAND_ID,
  builtinToolDefinitions,
  type ApiProviderKind,
  type PresetBundle
} from "@simpagent/agent-core";

export const DEFAULT_AGENT_A_ID = "00000000-0000-7000-8000-000000000201";
export const DEFAULT_AGENT_B_ID = "00000000-0000-7000-8000-000000000202";
export const DEFAULT_AGENT_C_ID = "00000000-0000-7000-8000-000000000203";
export const DEFAULT_PROVIDER_STRATEGY_ID = "00000000-0000-7000-8000-000000000301";
const DEFAULT_PROMPT_A_ID = "00000000-0000-7000-8000-000000000401";
const DEFAULT_PROMPT_B_ID = "00000000-0000-7000-8000-000000000402";
const DEFAULT_PROMPT_C_ID = "00000000-0000-7000-8000-000000000403";
const CREATED_AT = 0;

function node(input: {
  readonly id: string;
  readonly node_type: string;
  readonly name: string;
  readonly description: string;
}) {
  return {
    id: input.id,
    node_type: input.node_type,
    name: input.name,
    description: input.description,
    enabled: 1,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    metadata_json: null
  };
}

function edge(input: {
  readonly id: string;
  readonly source_node_id: string;
  readonly target_node_id: string;
  readonly edge_type: string;
  readonly description: string;
}) {
  return {
    id: input.id,
    source_node_id: input.source_node_id,
    target_node_id: input.target_node_id,
    edge_type: input.edge_type,
    name: null,
    description: input.description,
    enabled: 1,
    condition_json: null,
    metadata_json: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT
  };
}

function promptBinding(promptNodeId: string): string {
  return JSON.stringify([
    {
      kind: "prompt_unit",
      order: 0,
      enabled: true,
      target_node_id: promptNodeId
    }
  ]);
}

export function createDefaultPreset(input: {
  readonly provider: ApiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
}): PresetBundle {
  const toolNodes = builtinToolDefinitions.map((tool) => ({
    node_id: tool.id,
    tool_name: tool.name,
    description: tool.description,
    parameters_json: JSON.stringify(tool.parameters),
    executor_kind: "builtin",
    approval_policy: tool.name === "handoff" ? "always_approve" : "ask",
    config_json: null
  }));
  const toolIds = [
    BUILTIN_TOOL_READ_FILE_ID,
    BUILTIN_TOOL_EDIT_FILE_ID,
    BUILTIN_TOOL_SHELL_COMMAND_ID,
    BUILTIN_TOOL_HANDOFF_ID
  ];
  const agentIds = [DEFAULT_AGENT_A_ID, DEFAULT_AGENT_B_ID, DEFAULT_AGENT_C_ID];
  const promptIds = [DEFAULT_PROMPT_A_ID, DEFAULT_PROMPT_B_ID, DEFAULT_PROMPT_C_ID];
  const toolAccessEdges = agentIds.flatMap((agentId, agentIndex) =>
    toolIds.map((toolId, toolIndex) =>
      edge({
        id: `00000000-0000-7000-8000-000000000${agentIndex + 1}${toolIndex + 1}1`,
        source_node_id: agentId,
        target_node_id: toolId,
        edge_type: "tool_access",
        description: "默认 agent 可使用内置工具。"
      })
    )
  );

  return {
    nodes: [
      node({
        id: DEFAULT_AGENT_A_ID,
        node_type: "agent",
        name: "Agent A",
        description: "默认入口 agent，可发现 Agent B 和 Agent C。"
      }),
      node({
        id: DEFAULT_AGENT_B_ID,
        node_type: "agent",
        name: "Agent B",
        description: "第二个样板 agent，只能发现 Agent A。"
      }),
      node({
        id: DEFAULT_AGENT_C_ID,
        node_type: "agent",
        name: "Agent C",
        description: "第三个样板 agent，只能发现 Agent B。"
      }),
      node({
        id: DEFAULT_PROVIDER_STRATEGY_ID,
        node_type: "provider_strategy",
        name: "Default Provider",
        description: "server 启动时由 simpagent.toml 提供真实 provider 参数。"
      }),
      node({ id: DEFAULT_PROMPT_A_ID, node_type: "prompt_unit", name: "Agent A 默认提示词", description: "Agent A system prompt。" }),
      node({ id: DEFAULT_PROMPT_B_ID, node_type: "prompt_unit", name: "Agent B 默认提示词", description: "Agent B system prompt。" }),
      node({ id: DEFAULT_PROMPT_C_ID, node_type: "prompt_unit", name: "Agent C 默认提示词", description: "Agent C system prompt。" }),
      ...builtinToolDefinitions.map((tool) =>
        node({ id: tool.id, node_type: "tool", name: tool.name, description: tool.description })
      )
    ],
    provider_strategies: [
      {
        node_id: DEFAULT_PROVIDER_STRATEGY_ID,
        provider: input.provider,
        base_url: input.baseUrl,
        model: input.model,
        strategy_json: null,
        parameters_json: null
      }
    ],
    prompt_units: [
      {
        node_id: DEFAULT_PROMPT_A_ID,
        role: "system",
        content_template:
          "你是 SimpAgent 默认图中的 Agent A。你可以直接解决问题，也可以通过 handoff 交接给 Agent B 或 Agent C。",
        variables_json: null
      },
      {
        node_id: DEFAULT_PROMPT_B_ID,
        role: "system",
        content_template: "你是 SimpAgent 默认图中的 Agent B。你只能发现并 handoff 给 Agent A。",
        variables_json: null
      },
      {
        node_id: DEFAULT_PROMPT_C_ID,
        role: "system",
        content_template: "你是 SimpAgent 默认图中的 Agent C。你只能发现并 handoff 给 Agent B。",
        variables_json: null
      }
    ],
    tool_nodes: toolNodes,
    agent_nodes: [
      {
        node_id: DEFAULT_AGENT_A_ID,
        prompt_binding_json: promptBinding(DEFAULT_PROMPT_A_ID),
        tool_policy_json: null,
        provider_strategy_node_id: DEFAULT_PROVIDER_STRATEGY_ID,
        memory_policy_json: null
      },
      {
        node_id: DEFAULT_AGENT_B_ID,
        prompt_binding_json: promptBinding(DEFAULT_PROMPT_B_ID),
        tool_policy_json: null,
        provider_strategy_node_id: DEFAULT_PROVIDER_STRATEGY_ID,
        memory_policy_json: null
      },
      {
        node_id: DEFAULT_AGENT_C_ID,
        prompt_binding_json: promptBinding(DEFAULT_PROMPT_C_ID),
        tool_policy_json: null,
        provider_strategy_node_id: DEFAULT_PROVIDER_STRATEGY_ID,
        memory_policy_json: null
      }
    ],
    edges: [
      edge({
        id: "00000000-0000-7000-8000-000000000501",
        source_node_id: DEFAULT_AGENT_A_ID,
        target_node_id: DEFAULT_PROMPT_A_ID,
        edge_type: "prompt_binding",
        description: "Agent A 绑定默认 system prompt。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000502",
        source_node_id: DEFAULT_AGENT_B_ID,
        target_node_id: DEFAULT_PROMPT_B_ID,
        edge_type: "prompt_binding",
        description: "Agent B 绑定默认 system prompt。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000503",
        source_node_id: DEFAULT_AGENT_C_ID,
        target_node_id: DEFAULT_PROMPT_C_ID,
        edge_type: "prompt_binding",
        description: "Agent C 绑定默认 system prompt。"
      }),
      ...agentIds.map((agentId, index) =>
        edge({
          id: `00000000-0000-7000-8000-00000000051${index + 1}`,
          source_node_id: agentId,
          target_node_id: DEFAULT_PROVIDER_STRATEGY_ID,
          edge_type: "model_binding",
          description: "默认 agent 绑定同一个 provider strategy。"
        })
      ),
      edge({
        id: "00000000-0000-7000-8000-000000000601",
        source_node_id: DEFAULT_AGENT_A_ID,
        target_node_id: DEFAULT_AGENT_B_ID,
        edge_type: "discoverable",
        description: "A 可发现 B。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000602",
        source_node_id: DEFAULT_AGENT_A_ID,
        target_node_id: DEFAULT_AGENT_C_ID,
        edge_type: "discoverable",
        description: "A 可发现 C。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000603",
        source_node_id: DEFAULT_AGENT_B_ID,
        target_node_id: DEFAULT_AGENT_A_ID,
        edge_type: "discoverable",
        description: "B 只能发现 A。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000604",
        source_node_id: DEFAULT_AGENT_C_ID,
        target_node_id: DEFAULT_AGENT_B_ID,
        edge_type: "discoverable",
        description: "C 只能发现 B。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000701",
        source_node_id: DEFAULT_AGENT_A_ID,
        target_node_id: DEFAULT_AGENT_B_ID,
        edge_type: "handoff",
        description: "A 可 handoff 给 B。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000702",
        source_node_id: DEFAULT_AGENT_A_ID,
        target_node_id: DEFAULT_AGENT_C_ID,
        edge_type: "handoff",
        description: "A 可 handoff 给 C。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000703",
        source_node_id: DEFAULT_AGENT_B_ID,
        target_node_id: DEFAULT_AGENT_A_ID,
        edge_type: "handoff",
        description: "B 可 handoff 给 A。"
      }),
      edge({
        id: "00000000-0000-7000-8000-000000000704",
        source_node_id: DEFAULT_AGENT_C_ID,
        target_node_id: DEFAULT_AGENT_B_ID,
        edge_type: "handoff",
        description: "C 可 handoff 给 B。"
      }),
      ...toolAccessEdges
    ]
  };
}
