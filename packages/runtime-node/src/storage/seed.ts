/**
 * 本文件作用：
 * - 初始化默认的 Agent / PromptBlock / Workflow / Tool 配置。
 * - 让框架“开箱可跑”，同时保留后续通过 API 热更新的能力。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AgentSpec, CatalogNode, CatalogNodeFacet, JsonObject, PromptBlock, WorkflowSpec } from "../types/index.js";
import { AppDatabase } from "./db.js";
import { BUILTIN_TOOL_DEFINITIONS, buildBuiltinCatalogFacet, buildBuiltinCatalogNode } from "../core/tools/index.js";

function upsertCatalogPromptUnit(db: AppDatabase, block: PromptBlock, projectId: string): void {
  const node: CatalogNode = {
    nodeId: block.id,
    projectId,
    nodeClass: "item",
    name: block.name,
    title: block.name,
    summaryText: block.name,
    contentText: block.template,
    contentFormat: "markdown",
    primaryKind:
      block.kind === "worldbook" ? "worldbook" : block.kind === "memory" ? "memory" : "prompt",
    visibility: "visible",
    exposeMode: "content_direct",
    enabled: block.enabled !== false,
    sortOrder: block.priority,
    tags: block.tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const promptFacet: CatalogNodeFacet = {
    facetId: `facet.prompt.${block.id}`,
    nodeId: block.id,
    facetType: "prompt",
    payload: {
      promptKind: block.kind,
      role: block.role,
      insertionPoint: block.insertionPoint,
      variablesSchema: block.variablesSchema,
      tokenLimit: block.tokenLimit,
      priority: block.priority,
      trigger: block.trigger as JsonObject | undefined
    },
    updatedAt: new Date().toISOString()
  };
  db.saveCatalogNode(node);
  db.saveCatalogFacet(promptFacet);
}

/**
 * 幂等种子函数：
 * - 若已有配置则不重复写入（通过查询数量判断）。
 */
export function seedDefaultConfigs(db: AppDatabase, projectId = "default"): void {
  if (db.listAgents().length > 0) {
    return;
  }

  const blocks: PromptBlock[] = [
    {
      id: "block.system.safety",
      name: "系统安全声明",
      kind: "safety",
      template:
        "你是一个可调试的多 Agent 系统中的节点代理。必须输出结构化、可审计、避免伪造事实；当信息不足时明确说明不足。",
      insertionPoint: "system_pre",
      priority: 100,
      enabled: true,
      version: 1,
      tags: ["default"]
    },
    {
      id: "block.persona.orchestrator",
      name: "编排器人格",
      kind: "persona",
      template:
        "你的角色是编排器（orchestrator）。职责：拆分任务、路由节点、决定是否调用工具或委派，不直接长篇回答。",
      insertionPoint: "system_post",
      priority: 90,
      trigger: { agentIds: ["agent.orchestrator"] },
      enabled: true,
      version: 1
    },
    {
      id: "block.persona.worker",
      name: "执行代理人格",
      kind: "persona",
      template:
        "你的角色是执行代理（worker）。职责：根据任务完成具体生成；如需工具，先说明原因再调用。",
      insertionPoint: "system_post",
      priority: 80,
      trigger: { agentIds: ["agent.worker"] },
      enabled: true,
      version: 1
    },
    {
      id: "block.task.input",
      name: "任务输入块",
      kind: "task",
      template: "当前任务类型：{{taskType}}\\n用户输入：{{userInput}}",
      variablesSchema: {
        type: "object",
        properties: {
          taskType: { type: "string" },
          userInput: { type: "string" }
        },
        required: ["taskType", "userInput"]
      },
      insertionPoint: "task_pre",
      priority: 70,
      enabled: true,
      version: 1
    },
    {
      id: "block.tool.hint",
      name: "工具使用提示",
      kind: "tool_hint",
      template:
        "可用工具：{{toolNames}}。调用工具时必须使用结构化函数调用，不要在自然语言中假装已经执行过工具。",
      insertionPoint: "tool_context",
      priority: 60,
      enabled: true,
      version: 1
    }
  ];

  const agents: AgentSpec[] = [
    {
      id: "agent.orchestrator",
      name: "Orchestrator",
      role: "orchestrator",
      description: "负责拆分任务、选择下一个节点。",
      promptBindings: [
        { bindingId: "bind.orchestrator.system", unitId: "block.system.safety", enabled: true, order: 10 },
        { bindingId: "bind.orchestrator.persona", unitId: "block.persona.orchestrator", enabled: true, order: 20 },
        { bindingId: "bind.orchestrator.task", unitId: "block.task.input", enabled: true, order: 30 },
        { bindingId: "bind.orchestrator.tool", unitId: "block.tool.hint", enabled: true, order: 40 }
      ],
      toolAllowList: ["shell_command", "read_file", "web_search", "update_plan", "request_user_input", "handoff"],
      toolRoutePolicy: { mode: "auto", reason: "默认按 provider 能力自动选择" },
      memoryPolicies: [],
      handoffPolicy: {
        allowedTargets: ["agent.worker", "agent.reviewer"],
        allowDynamicHandoff: true,
        strategy: "hybrid"
      },
      enabled: true,
      version: 1,
      tags: ["default"]
    },
    {
      id: "agent.worker",
      name: "Worker",
      role: "worker",
      description: "负责完成具体文本生成与工具调用。",
      promptBindings: [
        { bindingId: "bind.worker.system", unitId: "block.system.safety", enabled: true, order: 10 },
        { bindingId: "bind.worker.persona", unitId: "block.persona.worker", enabled: true, order: 20 },
        { bindingId: "bind.worker.task", unitId: "block.task.input", enabled: true, order: 30 },
        { bindingId: "bind.worker.tool", unitId: "block.tool.hint", enabled: true, order: 40 }
      ],
      toolAllowList: ["shell_command", "read_file", "web_search", "apply_patch", "view_image", "handoff"],
      toolRoutePolicy: { mode: "native_function_first", reason: "优先用原生函数调用" },
      memoryPolicies: [],
      handoffPolicy: {
        allowedTargets: ["agent.reviewer"],
        allowDynamicHandoff: true,
        strategy: "hybrid"
      },
      enabled: true,
      version: 1
    },
    {
      id: "agent.reviewer",
      name: "Reviewer",
      role: "reviewer",
      description: "负责校验格式与总结结果。",
      promptBindings: [
        { bindingId: "bind.reviewer.system", unitId: "block.system.safety", enabled: true, order: 10 },
        { bindingId: "bind.reviewer.task", unitId: "block.task.input", enabled: true, order: 20 }
      ],
      toolAllowList: ["read_file", "update_plan"],
      toolRoutePolicy: { mode: "prompt_protocol_only", reason: "示例：强制走提示词协议回退" },
      memoryPolicies: [],
      enabled: true,
      version: 1
    }
  ];

  const workflow: WorkflowSpec = {
    id: "workflow.default",
    name: "默认多 Agent 工作流",
    entryNode: "node.orchestrator",
    nodes: [
      { id: "node.orchestrator", type: "agent", label: "编排器", agentId: "agent.orchestrator" },
      { id: "node.worker", type: "agent", label: "执行代理", agentId: "agent.worker" },
      { id: "node.review", type: "agent", label: "校验代理", agentId: "agent.reviewer" }
    ],
    edges: [
      { id: "edge.start_to_worker", from: "node.orchestrator", to: "node.worker", condition: { type: "always" } },
      { id: "edge.worker_to_review", from: "node.worker", to: "node.review", condition: { type: "always" } }
    ],
    interruptPolicy: {
      defaultInterruptBefore: false,
      defaultInterruptAfter: false
    },
    enabled: true,
    version: 1
  };

  for (const builtin of BUILTIN_TOOL_DEFINITIONS) {
    db.saveCatalogNode(buildBuiltinCatalogNode({ projectId, definition: builtin }));
    db.saveCatalogFacet(buildBuiltinCatalogFacet(builtin));
  }
  for (const block of blocks) {
    db.saveVersionedConfig("prompt_block", block);
    upsertCatalogPromptUnit(db, block, projectId);
  }
  for (const agent of agents) db.saveVersionedConfig("agent", agent);
  db.saveVersionedConfig("workflow", workflow);
  db.writeAudit("seed_default_configs", "system", "bootstrap", {
    agents: agents.length,
    blocks: blocks.length,
    tools: BUILTIN_TOOL_DEFINITIONS.length
  });
}

function readPresetArray<T>(presetDir: string, fileName: string): T[] {
  const filePath = path.join(presetDir, fileName);
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`预设文件必须是数组：${filePath}`);
  }
  return parsed as T[];
}

/**
 * 从 JSON 目录加载预设配置。
 * 说明：
 * - 这是三层配置中的 Preset 层（文件态）；
 * - 仅在“数据库里不存在同 ID 配置”时写入，避免覆盖用户热更新内容。
 */
export function seedPresetConfigsFromDir(
  db: AppDatabase,
  presetDir: string,
  projectId = "default"
): {
  tools: number;
  promptBlocks: number;
  agents: number;
  workflows: number;
} {
  if (!existsSync(presetDir)) {
    return { tools: 0, promptBlocks: 0, agents: 0, workflows: 0 };
  }

  const promptBlocks = readPresetArray<PromptBlock>(presetDir, "prompt_blocks.json");
  const agents = readPresetArray<AgentSpec>(presetDir, "agents.json");
  const workflows = readPresetArray<WorkflowSpec>(presetDir, "workflows.json");

  let toolsSaved = 0;
  let blocksSaved = 0;
  let agentsSaved = 0;
  let workflowsSaved = 0;

  for (const block of promptBlocks) {
    if (!db.getPromptBlock(block.id)) {
      db.saveVersionedConfig("prompt_block", block);
      upsertCatalogPromptUnit(db, block, projectId);
      blocksSaved += 1;
    }
  }

  for (const agent of agents) {
    if (!db.getAgent(agent.id)) {
      db.saveVersionedConfig("agent", agent);
      agentsSaved += 1;
    }
  }

  for (const workflow of workflows) {
    if (!db.getWorkflow(workflow.id)) {
      db.saveVersionedConfig("workflow", workflow);
      workflowsSaved += 1;
    }
  }

  db.writeAudit("seed_preset_from_json", "preset", presetDir, {
    presetDir,
    toolsSaved,
    promptBlocksSaved: blocksSaved,
    agentsSaved,
    workflowsSaved
  });

  return {
    tools: toolsSaved,
    promptBlocks: blocksSaved,
    agents: agentsSaved,
    workflows: workflowsSaved
  };
}
