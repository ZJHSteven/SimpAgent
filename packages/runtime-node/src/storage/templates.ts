/**
 * 本文件作用：
 * - 提供“框架级默认模板”定义与应用逻辑。
 * - 模板用于快速生成一整套可运行的 Agent / PromptBlock / Workflow 预设，
 *   让 dev-console 首次进入即可演示完整链路。
 *
 * 设计说明：
 * - 模板属于“Preset 层”（三层配置中的最底层），并不直接覆盖用户在 SQLite 的 Override。
 * - 应用模板的实现方式是写入版本化配置；因此可审计、可回放、可回滚到旧版本。
 */

import type { AgentSpec, PromptBlock, WorkflowSpec } from "../types/index.js";
import type { AppDatabase } from "./db.js";

export interface RuntimeTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  counts: {
    agents: number;
    promptBlocks: number;
    workflows: number;
  };
}

interface RuntimeTemplateDefinition extends RuntimeTemplateSummary {
  agents: AgentSpec[];
  promptBlocks: PromptBlock[];
  workflows: WorkflowSpec[];
}

export interface TemplateApplyResult {
  templateId: string;
  agentsSaved: number;
  promptBlocksSaved: number;
  workflowsSaved: number;
}

const MEDEDU_TEMPLATE: RuntimeTemplateDefinition = {
  id: "mededu-default-v1",
  name: "医学教育多智能体默认模板",
  description:
    "内置虚拟患者、临床导师、基础研究导师与记忆代理，覆盖问诊-审计-回放-分叉的全链路调试场景。",
  category: "medical-education",
  version: "1.0.0",
  counts: {
    agents: 7,
    promptBlocks: 6,
    workflows: 1
  },
  promptBlocks: [
    {
      id: "block.mededu.system.core",
      name: "医学场景系统约束",
      kind: "system_rule",
      template:
        "你运行在医学教育模拟环境中。你必须保持可审计、可追溯，不得伪造检查结果；信息不足时明确说明。",
      insertionPoint: "system_pre",
      priority: 100,
      enabled: true,
      version: 1,
      tags: ["mededu", "preset"]
    },
    {
      id: "block.mededu.patient.persona",
      name: "虚拟患者人格",
      kind: "persona",
      template:
        "你是虚拟患者，不知道明确诊断名。请根据既往病史与当前心理状态自然回答，不要直接透露隐藏病因。",
      insertionPoint: "system_post",
      priority: 90,
      trigger: { agentIds: ["agent.mededu.patient.main"] },
      enabled: true,
      version: 1,
      tags: ["mededu", "patient"]
    },
    {
      id: "block.mededu.worldbook.report",
      name: "世界书-检查报告上下文",
      kind: "worldbook",
      template:
        "【患者背景】HIV 相关合并感染疑似病例。\\n【关键指标】CD4 计数下降、炎症指标升高、肾功能异常趋势。\\n【说明】仅在医生提出检查请求后可逐步披露具体检验结果。",
      insertionPoint: "memory_context",
      priority: 80,
      enabled: true,
      version: 1,
      tags: ["mededu", "worldbook"]
    },
    {
      id: "block.mededu.clinical.mentor",
      name: "临床导师指导提示",
      kind: "persona",
      template:
        "你是临床导师，需点评学生问诊策略：问题完整性、沟通态度、风险识别、下一步建议。",
      insertionPoint: "system_post",
      priority: 75,
      trigger: { agentIds: ["agent.mededu.mentor.clinical"] },
      enabled: true,
      version: 1,
      tags: ["mededu", "mentor", "clinical"]
    },
    {
      id: "block.mededu.research.mentor",
      name: "基础研究导师提示",
      kind: "persona",
      template:
        "你是基础研究导师，需将病情推理映射到证据链与研究问题，给出可检索关键词和论文方向。",
      insertionPoint: "system_post",
      priority: 74,
      trigger: { agentIds: ["agent.mededu.mentor.research"] },
      enabled: true,
      version: 1,
      tags: ["mededu", "mentor", "research"]
    },
    {
      id: "block.mededu.tools.hint",
      name: "工具使用提示",
      kind: "tool_hint",
      template:
        "如需检索资料，请先说明检索目的，再通过工具调用执行；所有工具输出必须在回答中标记来源。",
      insertionPoint: "tool_context",
      priority: 60,
      enabled: true,
      version: 1,
      tags: ["mededu", "tools"]
    }
  ],
  agents: [
    {
      id: "agent.mededu.patient.main",
      name: "虚拟患者主代理",
      role: "patient",
      description: "负责扮演患者进行自然对话，依据记忆与检查结果动态回复。",
      promptBindings: [
        { bindingId: "bind.patient.system", unitId: "block.mededu.system.core", enabled: true, order: 10 },
        { bindingId: "bind.patient.persona", unitId: "block.mededu.patient.persona", enabled: true, order: 20 },
        { bindingId: "bind.patient.world", unitId: "block.mededu.worldbook.report", enabled: true, order: 30 },
        { bindingId: "bind.patient.tool", unitId: "block.mededu.tools.hint", enabled: true, order: 40 }
      ],
      toolAllowList: ["web_search", "read_file", "request_user_input"],
      toolRoutePolicy: { mode: "auto", reason: "按 provider 能力自动选择路由" },
      modelPolicyId: "model.default",
      promptAssemblyPolicyId: "prompt.default",
      contextPolicyId: "context.default",
      toolPolicyId: "toolpolicy.patient",
      memoryPolicies: ["memory.timeline", "memory.affinity", "memory.exam"],
      handoffPolicy: {
        allowedTargets: ["agent.mededu.mentor.clinical", "agent.mededu.mentor.research"],
        allowDynamicHandoff: true,
        strategy: "hybrid"
      },
      outputContract: { type: "text" },
      postChecks: [],
      enabled: true,
      version: 1,
      tags: ["mededu", "patient"]
    },
    {
      id: "agent.mededu.memory.timeline",
      name: "时间线记忆代理",
      role: "memory_timeline",
      description: "按轮次记录发生了哪些客观事实，仅保留有实质影响的信息。",
      promptBindings: [
        { bindingId: "bind.timeline.system", unitId: "block.mededu.system.core", enabled: true, order: 10 },
        { bindingId: "bind.timeline.world", unitId: "block.mededu.worldbook.report", enabled: true, order: 20 }
      ],
      toolAllowList: ["update_plan"],
      toolRoutePolicy: { mode: "native_function_first" },
      modelPolicyId: "model.default",
      promptAssemblyPolicyId: "prompt.default",
      contextPolicyId: "context.default",
      toolPolicyId: "toolpolicy.memory",
      memoryPolicies: [],
      postChecks: [],
      enabled: true,
      version: 1,
      tags: ["mededu", "memory"]
    },
    {
      id: "agent.mededu.memory.affinity",
      name: "好感度记忆代理",
      role: "memory_affinity",
      description: "评估患者对医生的信任与配合程度，输出结构化分值。",
      promptBindings: [
        { bindingId: "bind.affinity.system", unitId: "block.mededu.system.core", enabled: true, order: 10 }
      ],
      toolAllowList: ["update_plan"],
      toolRoutePolicy: { mode: "native_function_first" },
      modelPolicyId: "model.default",
      promptAssemblyPolicyId: "prompt.default",
      contextPolicyId: "context.default",
      toolPolicyId: "toolpolicy.memory",
      memoryPolicies: [],
      postChecks: [],
      enabled: true,
      version: 1,
      tags: ["mededu", "memory"]
    },
    {
      id: "agent.mededu.memory.exam",
      name: "检查结果记忆代理",
      role: "memory_exam",
      description: "解析医生触发的检查请求，并生成可回填到患者对话的检查结论摘要。",
      promptBindings: [
        { bindingId: "bind.exam.system", unitId: "block.mededu.system.core", enabled: true, order: 10 },
        { bindingId: "bind.exam.world", unitId: "block.mededu.worldbook.report", enabled: true, order: 20 }
      ],
      toolAllowList: ["read_file", "update_plan"],
      toolRoutePolicy: { mode: "native_function_first" },
      modelPolicyId: "model.default",
      promptAssemblyPolicyId: "prompt.default",
      contextPolicyId: "context.default",
      toolPolicyId: "toolpolicy.memory",
      memoryPolicies: [],
      postChecks: [],
      enabled: true,
      version: 1,
      tags: ["mededu", "memory"]
    },
    {
      id: "agent.mededu.trigger",
      name: "触发器路由代理",
      role: "trigger_router",
      description: "低成本判断本轮是否需要触发记忆更新与检查流程。",
      promptBindings: [
        { bindingId: "bind.trigger.system", unitId: "block.mededu.system.core", enabled: true, order: 10 }
      ],
      toolAllowList: ["update_plan"],
      toolRoutePolicy: { mode: "native_function_first" },
      modelPolicyId: "model.default",
      promptAssemblyPolicyId: "prompt.default",
      contextPolicyId: "context.default",
      toolPolicyId: "toolpolicy.router",
      memoryPolicies: [],
      postChecks: [],
      enabled: true,
      version: 1,
      tags: ["mededu", "router"]
    },
    {
      id: "agent.mededu.mentor.clinical",
      name: "临床导师代理",
      role: "mentor_clinical",
      description: "点评学生问诊是否完整、温和、符合临床流程。",
      promptBindings: [
        { bindingId: "bind.clinical.system", unitId: "block.mededu.system.core", enabled: true, order: 10 },
        { bindingId: "bind.clinical.persona", unitId: "block.mededu.clinical.mentor", enabled: true, order: 20 },
        { bindingId: "bind.clinical.tool", unitId: "block.mededu.tools.hint", enabled: true, order: 30 }
      ],
      toolAllowList: ["web_search", "read_file"],
      toolRoutePolicy: { mode: "native_function_first" },
      modelPolicyId: "model.default",
      promptAssemblyPolicyId: "prompt.default",
      contextPolicyId: "context.default",
      toolPolicyId: "toolpolicy.mentor",
      memoryPolicies: [],
      postChecks: [],
      enabled: true,
      version: 1,
      tags: ["mededu", "mentor"]
    },
    {
      id: "agent.mededu.mentor.research",
      name: "基础研究导师代理",
      role: "mentor_research",
      description: "结合网络检索与前沿证据给出研究导向建议。",
      promptBindings: [
        { bindingId: "bind.research.system", unitId: "block.mededu.system.core", enabled: true, order: 10 },
        { bindingId: "bind.research.persona", unitId: "block.mededu.research.mentor", enabled: true, order: 20 },
        { bindingId: "bind.research.tool", unitId: "block.mededu.tools.hint", enabled: true, order: 30 }
      ],
      toolAllowList: ["web_search", "read_file", "view_image"],
      toolRoutePolicy: { mode: "native_function_first" },
      modelPolicyId: "model.default",
      promptAssemblyPolicyId: "prompt.default",
      contextPolicyId: "context.default",
      toolPolicyId: "toolpolicy.mentor",
      memoryPolicies: [],
      postChecks: [],
      enabled: true,
      version: 1,
      tags: ["mededu", "mentor", "research"]
    }
  ],
  workflows: [
    {
      id: "workflow.mededu.default",
      name: "医学教育-患者问诊工作流",
      entryNode: "node.trigger",
      nodes: [
        { id: "node.trigger", type: "agent", label: "触发器", agentId: "agent.mededu.trigger" },
        { id: "node.patient", type: "agent", label: "患者主代理", agentId: "agent.mededu.patient.main" },
        { id: "node.timeline", type: "agent", label: "时间线记忆", agentId: "agent.mededu.memory.timeline" },
        { id: "node.affinity", type: "agent", label: "好感度记忆", agentId: "agent.mededu.memory.affinity" },
        { id: "node.exam", type: "agent", label: "检查记忆", agentId: "agent.mededu.memory.exam" },
        { id: "node.clinical", type: "agent", label: "临床导师", agentId: "agent.mededu.mentor.clinical" },
        { id: "node.research", type: "agent", label: "研究导师", agentId: "agent.mededu.mentor.research" }
      ],
      edges: [
        { id: "edge.trigger_patient", from: "node.trigger", to: "node.patient", condition: { type: "always" } },
        { id: "edge.patient_timeline", from: "node.patient", to: "node.timeline", condition: { type: "always" } },
        { id: "edge.timeline_affinity", from: "node.timeline", to: "node.affinity", condition: { type: "always" } },
        { id: "edge.affinity_exam", from: "node.affinity", to: "node.exam", condition: { type: "always" } },
        { id: "edge.exam_clinical", from: "node.exam", to: "node.clinical", condition: { type: "always" } },
        { id: "edge.clinical_research", from: "node.clinical", to: "node.research", condition: { type: "always" } }
      ],
      routingPolicies: [
        { id: "route.trigger", nodeId: "node.trigger", mode: "hybrid" },
        { id: "route.patient", nodeId: "node.patient", mode: "hybrid" },
        { id: "route.timeline", nodeId: "node.timeline", mode: "fixed" },
        { id: "route.affinity", nodeId: "node.affinity", mode: "fixed" },
        { id: "route.exam", nodeId: "node.exam", mode: "fixed" },
        { id: "route.clinical", nodeId: "node.clinical", mode: "fixed" }
      ],
      interruptPolicy: {
        defaultInterruptBefore: false,
        defaultInterruptAfter: false
      },
      enabled: true,
      version: 1
    }
  ]
};

const TEMPLATES: RuntimeTemplateDefinition[] = [MEDEDU_TEMPLATE];

export function listRuntimeTemplates(): RuntimeTemplateSummary[] {
  return TEMPLATES.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    version: item.version,
    counts: item.counts
  }));
}

export function applyRuntimeTemplate(db: AppDatabase, templateId: string): TemplateApplyResult {
  const template = TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`模板不存在：${templateId}`);
  }

  for (const block of template.promptBlocks) db.saveVersionedConfig("prompt_block", block);
  for (const agent of template.agents) db.saveVersionedConfig("agent", agent);
  for (const workflow of template.workflows) db.saveVersionedConfig("workflow", workflow);

  db.writeAudit("apply_template", "template", template.id, {
    templateId: template.id,
    counts: template.counts
  });

  return {
    templateId: template.id,
    agentsSaved: template.agents.length,
    promptBlocksSaved: template.promptBlocks.length,
    workflowsSaved: template.workflows.length
  };
}
