/**
 * 本文件作用：
 * - 实现 Prompt 编译器（v0.3）：以 Agent.promptBindings 为核心，把持久化 PromptUnitSpec
 *   编译为最终 messages[]。
 * - 运行时主执行面只消费 messages；同时输出 trace 便于调试与追溯。
 *
 * 设计要点：
 * 1) 持久化层统一为 PromptUnitSpec（旧 PromptBlock 通过类型别名兼容）；
 * 2) Agent 决定“启用与顺序”，PromptUnitSpec 只保存可复用定义；
 * 3) 每条最终 message 都带来源元信息（sourceUnitId/sourceKind/bindingId）。
 */

import type {
  AgentPromptBinding,
  AgentSpec,
  JsonObject,
  MessageRole,
  PromptAssemblyPlan,
  PromptBlock,
  PromptCompileRequest,
  PromptCompileResult,
  PromptInsertionPoint,
  PromptOverridePatch,
  PromptPlacement,
  PromptTrace,
  PromptUnit,
  PromptUnitOverride,
  UnifiedMessage
} from "../types/index.js";

/**
 * 生成一次 Prompt 编译的唯一 ID。
 * 说明：
 * - 优先用 `crypto.randomUUID()`，保证不同 run / thread 下更稳；
 * - fallback 只是兼容缺少 Web Crypto 的环境。
 */
function newCompileId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return `pc_${cryptoApi.randomUUID().replace(/-/g, "")}`;
  return `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * slot 模式下的大区块基础顺序。
 * 数值越小越靠前；这里只决定“大的区域先后”，同一区域内部还会再比较 sortWeight。
 */
const SLOT_ORDER: Record<PromptInsertionPoint, number> = {
  system_pre: 100,
  system_post: 120,
  developer: 200,
  memory_context: 300,
  tool_context: 350,
  task_pre: 800,
  task_post: 820
};

interface MessageRecord {
  unitId: string;
  role: MessageRole;
  content: string;
  metadata?: JsonObject;
}

/**
 * Prompt 编译阶段的统一中间结构。
 * 说明：
 * - 显式 PromptUnit、history、memory、tool catalog、task envelope 最后都会先变成它；
 * - 这样排序、插入、override 不需要分别为每种来源写一套逻辑。
 */
interface CompiledUnit {
  id: string;
  source: PromptUnit["source"];
  enabled: boolean;
  role: MessageRole;
  contentTemplate: string;
  renderedContent?: string;
  placement: PromptPlacement;
  sortWeight: number;
  metadata?: JsonObject;
}

interface OverrideApplyResult {
  units: PromptBlock[];
  disabledUnitIds: Set<string>;
}

/**
 * 用最小模板语法渲染 `{{var}}`。
 * 这里故意保持简单，避免 PromptCompiler 自己演化成复杂模板引擎。
 */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/**
 * 用字符数粗略估算 token。
 * 目的不是精确计费，而是给 Prompt 裁剪和 debug 提供一个稳定参考值。
 */
function estimateTokensByChars(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function isMessageRole(value: unknown): value is MessageRole {
  return value === "system" || value === "developer" || value === "user" || value === "assistant" || value === "tool";
}

function isPromptPlacement(value: unknown): value is PromptPlacement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const mode = obj.mode;
  if (mode === "slot") return typeof obj.slot === "string";
  if (mode === "before_message_id" || mode === "after_message_id") return typeof obj.messageId === "string";
  if (mode === "before_role_anchor" || mode === "after_role_anchor") return isMessageRole(obj.role);
  return mode === "end";
}

function placementFromInsertionPoint(insertionPoint: PromptInsertionPoint): PromptPlacement {
  return { mode: "slot", slot: insertionPoint };
}

/**
 * 判断某个 PromptUnit 在这次请求里是否应该生效。
 * 当前支持：
 * - agentIds
 * - taskTypes
 * - keywords
 * - expression（暂时只接受，不执行表达式求值）
 */
function shouldUnitApply(unit: PromptBlock, req: PromptCompileRequest): { ok: boolean; reason: string } {
  const trigger = unit.trigger;
  if (!trigger) return { ok: true, reason: "no trigger (default include)" };

  if (trigger.agentIds && !trigger.agentIds.includes(req.agentId)) {
    return { ok: false, reason: "agentId not matched" };
  }
  if (trigger.taskTypes && !trigger.taskTypes.includes(req.taskEnvelope.taskType)) {
    return { ok: false, reason: "taskType not matched" };
  }
  if (trigger.keywords && trigger.keywords.length > 0) {
    const mergedText = [
      req.taskEnvelope.taskType,
      JSON.stringify(req.taskEnvelope.input),
      ...req.contextSources.slice(0, 20).map((item) => item.content)
    ]
      .join("\n")
      .toLowerCase();
    const hit = trigger.keywords.some((kw) => mergedText.includes(kw.toLowerCase()));
    if (!hit) return { ok: false, reason: "keyword not matched" };
  }
  if (trigger.expression) return { ok: true, reason: "expression accepted (not evaluated in v0.3)" };
  return { ok: true, reason: "trigger matched" };
}

/**
 * 构造模板变量。
 * 这些变量不仅给显式 PromptUnit 使用，也会给后面做兜底渲染的运行态单元复用。
 */
function buildVars(req: PromptCompileRequest): Record<string, string> {
  const toolNames = req.toolSchemas.map((tool) => tool.toolName).join(", ") || "（无）";
  return {
    taskType: req.taskEnvelope.taskType,
    userInput: String(req.taskEnvelope.input.userInput ?? req.taskEnvelope.input.input ?? ""),
    toolNames,
    runId: req.runId,
    threadId: req.threadId,
    agentId: req.agentId
  };
}

/**
 * 应用旧版 override patch。
 * 说明：
 * - 这一步操作的是“原始 PromptUnit 定义”；
 * - 更细粒度的角色/位置/排序调整由后面的 `promptUnitOverrides` 负责。
 */
function applyOverridePatches(units: PromptBlock[], patches: PromptOverridePatch[] | undefined): OverrideApplyResult {
  if (!patches || patches.length === 0) {
    return {
      units,
      disabledUnitIds: new Set()
    };
  }
  const map = new Map(units.map((item) => [item.id, { ...item }]));
  const disabledUnitIds = new Set<string>();
  for (const patch of patches) {
    const targetId = patch.targetUnitId ?? patch.targetBlockId;
    if ((patch.type === "disable_unit" || patch.type === "disable_block") && targetId) {
      disabledUnitIds.add(targetId);
      continue;
    }
    if ((patch.type === "replace_unit_template" || patch.type === "replace_block_template") && targetId) {
      const target = map.get(targetId);
      const template = patch.payload.template;
      if (target && typeof template === "string") target.template = template;
      continue;
    }
    if (patch.type === "insert_ad_hoc_unit" || patch.type === "insert_ad_hoc_block") {
      const adHoc: PromptBlock = {
        id: `adhoc.${patch.patchId}`,
        name: "AdHoc Debug Unit",
        kind: "hidden_internal",
        template: String(patch.payload.template ?? ""),
        role: isMessageRole(patch.payload.role) ? patch.payload.role : "developer",
        insertionPoint: (patch.payload.insertionPoint as PromptInsertionPoint) ?? "developer",
        priority: Number(patch.payload.priority ?? 999),
        version: 1
      };
      map.set(adHoc.id, adHoc);
    }
  }
  return {
    units: [...map.values()],
    disabledUnitIds
  };
}

/**
 * 对上下文来源做首版裁剪。
 * 当前策略：
 * - 先保留高 importance 的 pinned 项；
 * - 再从最近内容中补齐预算。
 */
function sliceContextSources(req: PromptCompileRequest): {
  kept: PromptCompileRequest["contextSources"];
  omitted: PromptCompileRequest["contextSources"];
  omittedReport: PromptCompileResult["omittedContextReport"];
} {
  const budget = 10;
  const pinned = req.contextSources.filter((item) => (item.importance ?? 0) >= 0.9);
  const rest = req.contextSources.filter((item) => !pinned.includes(item));
  const kept = [...pinned];
  for (const item of rest.slice(-Math.max(0, budget - kept.length))) kept.push(item);
  const keptSet = new Set(kept.map((item) => item.id));
  const omitted = req.contextSources.filter((item) => !keptSet.has(item.id));
  return {
    kept,
    omitted,
    omittedReport: omitted.map((item) => ({
      sourceId: item.id,
      reason: "context slice by importance + recent budget"
    }))
  };
}

/**
 * 应用新版 `promptUnitOverrides`。
 * 这一步作用于已经统一成 `CompiledUnit` 的结果，因此可以改内容、角色、位置和排序。
 */
function applyCompiledUnitOverrides(units: CompiledUnit[], overrides: PromptUnitOverride[] | undefined): CompiledUnit[] {
  if (!overrides || overrides.length === 0) return units;
  const map = new Map(units.map((unit) => [unit.id, { ...unit }]));
  for (const override of overrides) {
    const target = map.get(override.unitId);
    if (!target) continue;
    if (override.action === "enable") {
      target.enabled = true;
      continue;
    }
    if (override.action === "disable") {
      target.enabled = false;
      continue;
    }
    if (override.action === "replace_content") {
      const value = override.payload.contentTemplate;
      if (typeof value === "string") target.contentTemplate = value;
      continue;
    }
    if (override.action === "change_role") {
      const role = override.payload.role;
      if (isMessageRole(role)) target.role = role;
      continue;
    }
    if (override.action === "change_placement") {
      const placement = override.payload.placement;
      if (isPromptPlacement(placement)) target.placement = placement;
      continue;
    }
    if (override.action === "change_sort") {
      const sort = Number(override.payload.sortWeight);
      if (Number.isFinite(sort)) target.sortWeight = sort;
    }
  }
  return [...map.values()];
}

/**
 * 计算一个单元的基础顺序权重。
 * 规则：
 * - slot 模式跟随 `SLOT_ORDER`
 * - role/message anchor 使用固定区间，保证它们在基线消息之后再插入
 */
function baseOrderWeight(unit: CompiledUnit): number {
  if (unit.placement.mode === "slot") return SLOT_ORDER[unit.placement.slot] ?? 500;
  if (unit.placement.mode === "before_role_anchor") return 50;
  if (unit.placement.mode === "after_role_anchor") return 950;
  if (unit.placement.mode === "before_message_id") return 480;
  if (unit.placement.mode === "after_message_id") return 520;
  return 1000;
}

/**
 * 处理“以某种 role 为锚点”的插入。
 * 没找到锚点时，不报错，而是降级追加到末尾并记录 note。
 */
function insertByRoleAnchor(records: MessageRecord[], unit: CompiledUnit, notes: string[]): void {
  if (!unit.enabled || !unit.renderedContent) return;
  if (unit.placement.mode !== "before_role_anchor" && unit.placement.mode !== "after_role_anchor") return;
  const placement = unit.placement;
  const indices = records
    .map((item, idx) => ({ idx, role: item.role }))
    .filter((item) => item.role === placement.role)
    .map((item) => item.idx);
  if (indices.length === 0) {
    notes.push(`PromptUnit ${unit.id} role anchor 未命中，已追加到末尾`);
    records.push({
      unitId: unit.id,
      role: unit.role,
      content: unit.renderedContent,
      metadata: unit.metadata
    });
    return;
  }
  const insertAt = placement.mode === "before_role_anchor" ? indices[0] : indices[indices.length - 1] + 1;
  records.splice(insertAt, 0, {
    unitId: unit.id,
    role: unit.role,
    content: unit.renderedContent,
    metadata: unit.metadata
  });
}

/**
 * 处理“以某条 messageId 为锚点”的插入。
 * 如果锚点不存在，同样降级追加到末尾，避免该单元被静默吞掉。
 */
function insertByMessageAnchor(records: MessageRecord[], unit: CompiledUnit, notes: string[]): void {
  if (!unit.enabled || !unit.renderedContent) return;
  if (unit.placement.mode !== "before_message_id" && unit.placement.mode !== "after_message_id") return;
  const placement = unit.placement;
  const anchorIndex = records.findIndex((item) => item.unitId === placement.messageId);
  if (anchorIndex < 0) {
    notes.push(`PromptUnit ${unit.id} message anchor=${placement.messageId} 未命中，已追加到末尾`);
    records.push({
      unitId: unit.id,
      role: unit.role,
      content: unit.renderedContent,
      metadata: unit.metadata
    });
    return;
  }
  const insertAt = placement.mode === "before_message_id" ? anchorIndex : anchorIndex + 1;
  records.splice(insertAt, 0, {
    unitId: unit.id,
    role: unit.role,
    content: unit.renderedContent,
    metadata: unit.metadata
  });
}

/**
 * 把所有编译单元装配成最终 `messages[]`。
 * 顺序：
 * 1. 先排好基线单元；
 * 2. 再插入 role anchor；
 * 3. 最后插入 message anchor。
 */
function assembleMessages(units: CompiledUnit[]): { finalMessages: UnifiedMessage[]; orderedUnitIds: string[]; notes: string[] } {
  const notes: string[] = [];
  const sorted = [...units].sort((a, b) => {
    const orderDiff = baseOrderWeight(a) - baseOrderWeight(b);
    if (orderDiff !== 0) return orderDiff;
    const weightDiff = b.sortWeight - a.sortWeight;
    if (weightDiff !== 0) return weightDiff;
    return a.id.localeCompare(b.id);
  });

  const baseUnits = sorted.filter(
    (unit) =>
      unit.enabled &&
      unit.renderedContent &&
      unit.placement.mode !== "before_role_anchor" &&
      unit.placement.mode !== "after_role_anchor" &&
      unit.placement.mode !== "before_message_id" &&
      unit.placement.mode !== "after_message_id"
  );
  const roleAnchorUnits = sorted.filter(
    (unit) => unit.placement.mode === "before_role_anchor" || unit.placement.mode === "after_role_anchor"
  );
  const messageAnchorUnits = sorted.filter(
    (unit) => unit.placement.mode === "before_message_id" || unit.placement.mode === "after_message_id"
  );

  const records: MessageRecord[] = baseUnits.map((unit) => ({
    unitId: unit.id,
    role: unit.role,
    content: unit.renderedContent ?? "",
    metadata: unit.metadata
  }));

  for (const unit of roleAnchorUnits) insertByRoleAnchor(records, unit, notes);
  for (const unit of messageAnchorUnits) insertByMessageAnchor(records, unit, notes);

  return {
    finalMessages: records.map((item) => ({
      role: item.role,
      content: item.content,
      metadata: item.metadata
    })),
    orderedUnitIds: records.map((item) => item.unitId),
    notes
  };
}

/**
 * 兼容旧配置：当 Agent 没写 `promptBindings` 时，按旧 priority 规则自动生成一份 binding。
 */
function buildLegacyBindings(units: PromptBlock[]): AgentPromptBinding[] {
  return units
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .map((unit, idx) => ({
      bindingId: `legacy.binding.${unit.id}`,
      unitId: unit.id,
      enabled: true,
      order: idx + 1
    }));
}

export class PromptCompiler {
  /**
   * 编译 Prompt。
   * 主流程可以按六步理解：
   * 1. 准备变量与 override；
   * 2. 根据 Agent 绑定选择显式 PromptUnit；
   * 3. 注入 history / memory / tool catalog / task 等运行态单元；
   * 4. 应用编译后 override；
   * 5. 装配最终 messages；
   * 6. 生成 PromptTrace 与 PromptAssemblyPlan。
   */
  compile(params: {
    agent: AgentSpec;
    blocks: PromptBlock[];
    request: PromptCompileRequest;
    contextPolicyLabel?: string;
  }): PromptCompileResult {
    const compileId = newCompileId();
    const contextPolicyLabel = params.contextPolicyLabel ?? "context.importance_recent(v0.3)";
    const vars = buildVars(params.request);
    // 第一步：先对原始定义层应用旧版 patch。
    const patched = applyOverridePatches(params.blocks, params.request.overridePatches);
    const units = patched.units;
    const unitById = new Map(units.map((item) => [item.id, item]));
    // Agent 自己的 promptBindings 优先；没有时再退回旧版 priority 逻辑。
    const bindings = (params.agent.promptBindings && params.agent.promptBindings.length > 0
      ? params.agent.promptBindings
      : buildLegacyBindings(units)
    ).slice();

    const selectedUnits: PromptTrace["selectedUnits"] = [];
    const rejectedUnits: PromptTrace["rejectedUnits"] = [];
    const renderedVariables: PromptTrace["renderedVariables"] = [];

    // 第二步：把显式 PromptUnit 编译成统一内部结构。
    const compiledFromBindings: CompiledUnit[] = [];
    for (const binding of bindings.sort((a, b) => a.order - b.order)) {
      if (!binding.enabled) continue;
      if (patched.disabledUnitIds.has(binding.unitId)) {
        rejectedUnits.push({
          unitId: binding.unitId,
          version: unitById.get(binding.unitId)?.version ?? 0,
          reason: "disabled by override patch"
        });
        continue;
      }
      const unit = unitById.get(binding.unitId);
      if (!unit) {
        rejectedUnits.push({
          unitId: binding.unitId,
          version: 0,
          reason: "unit not found"
        });
        continue;
      }
      const verdict = shouldUnitApply(unit, params.request);
      if (!verdict.ok) {
        rejectedUnits.push({
          unitId: unit.id,
          version: unit.version,
          reason: verdict.reason
        });
        continue;
      }
      const mergedVars = {
        ...vars,
        ...Object.entries(binding.variableOverrides ?? {}).reduce<Record<string, string>>((acc, [k, v]) => {
          acc[k] = String(v);
          return acc;
        }, {})
      };
      const rendered = renderTemplate(unit.template, mergedVars);
      const tokenLimit = binding.tokenLimitOverride ?? unit.tokenLimit;
      if (typeof tokenLimit === "number" && tokenLimit > 0 && estimateTokensByChars(rendered) > tokenLimit) {
        rejectedUnits.push({
          unitId: unit.id,
          version: unit.version,
          reason: `token limit exceeded (${tokenLimit})`
        });
        continue;
      }

      for (const [key, value] of Object.entries(mergedVars)) {
        if (unit.template.includes(`{{${key}}}`)) {
          renderedVariables.push({
            unitId: unit.id,
            variable: key,
            valuePreview: String(value).slice(0, 120)
          });
        }
      }

      selectedUnits.push({
        unitId: unit.id,
        version: unit.version,
        insertionPoint: binding.insertionPointOverride ?? unit.insertionPoint,
        priority: binding.priorityOverride ?? unit.priority,
        reason: verdict.reason,
        renderedTextPreview: rendered.slice(0, 200),
        tokenEstimate: estimateTokensByChars(rendered)
      });

      compiledFromBindings.push({
        id: `compiled.binding.${binding.bindingId ?? binding.unitId}`,
        source:
          unit.sourceRef?.kind === "catalog_node"
            ? {
                kind: "catalog_node",
                nodeId: unit.sourceRef.nodeId,
                facetType: unit.sourceRef.facetType,
                primaryKind: unit.sourceRef.primaryKind,
                promptKind: unit.kind
              }
            : {
                kind: "prompt_unit",
                unitId: unit.id,
                unitVersion: unit.version,
                promptKind: unit.kind
              },
        enabled: true,
        role: binding.roleOverride ?? unit.role ?? (unit.insertionPoint.startsWith("system_") ? "system" : "developer"),
        contentTemplate: unit.template,
        renderedContent: rendered,
        placement: placementFromInsertionPoint(binding.insertionPointOverride ?? unit.insertionPoint),
        sortWeight: binding.priorityOverride ?? unit.priority,
        metadata: {
          sourceKind: unit.sourceRef?.kind === "catalog_node" ? "catalog_node" : "prompt_unit",
          sourceNodeId: unit.sourceRef?.kind === "catalog_node" ? unit.sourceRef.nodeId : null,
          sourceUnitId: unit.id,
          bindingId: binding.bindingId ?? null,
          promptKind: unit.kind
        }
      });
    }

    // 第三步：把运行态上下文也投影成同一种结构，后面才能共用同一套装配逻辑。
    const sliced = sliceContextSources(params.request);
    const historyUnits: CompiledUnit[] = sliced.kept.map((item, idx) => {
      const roleHint = item.metadata?.role;
      const role: MessageRole = isMessageRole(roleHint) ? roleHint : "user";
      return {
        id: `compiled.history.${item.id}`,
        source: { kind: "history_message", messageIndex: idx, originalRole: role },
        enabled: true,
        role,
        contentTemplate: item.content,
        renderedContent: item.content,
        placement: { mode: "end" },
        sortWeight: Number(item.importance ?? 0),
        metadata: {
          sourceKind: "history_message",
          sourceId: item.id,
          sourceType: item.type
        }
      };
    });

    const memoryUnits: CompiledUnit[] = params.request.memoryInputs.map((item, idx) => ({
      id: `compiled.memory.${item.adapterId}.${idx + 1}`,
      source: { kind: "memory_delegate", adapterId: item.adapterId },
      enabled: true,
      role: "developer",
      contentTemplate: item.content,
      renderedContent: item.content,
      placement: { mode: "slot", slot: "memory_context" },
      sortWeight: Number(item.score ?? 0),
      metadata: {
        sourceKind: "memory_delegate",
        adapterId: item.adapterId
      }
    }));

    const toolCatalogText = params.request.toolSchemas.map((t) => `- ${t.toolName}: ${t.description}`).join("\n");
    const toolCatalogUnit: CompiledUnit = {
      id: "compiled.tool_catalog.default",
      source: { kind: "tool_catalog", scope: "runtime_exposed" },
      enabled: params.request.toolSchemas.length > 0,
      role: "developer",
      contentTemplate: `当前可用工具：\n${toolCatalogText}`,
      renderedContent: params.request.toolSchemas.length > 0 ? `当前可用工具：\n${toolCatalogText}` : undefined,
      placement: { mode: "slot", slot: "tool_context" },
      sortWeight: 10,
      metadata: { sourceKind: "tool_catalog" }
    };

    const taskUnit: CompiledUnit = {
      id: "compiled.task.payload",
      source: { kind: "manual_override", operator: "runtime_task_envelope" },
      enabled: true,
      role: "user",
      contentTemplate: JSON.stringify(params.request.taskEnvelope.input, null, 2),
      renderedContent: `任务类型: ${params.request.taskEnvelope.taskType}\n任务输入:\n${JSON.stringify(
        params.request.taskEnvelope.input,
        null,
        2
      )}`,
      placement: { mode: "slot", slot: "task_post" },
      sortWeight: 1000,
      metadata: { sourceKind: "task_envelope" }
    };

    // 第四步：合并所有来源，再应用编译后 override。
    const mergedUnits = [...compiledFromBindings, ...historyUnits, ...memoryUnits, toolCatalogUnit, taskUnit];
    const finalCompiledUnits = applyCompiledUnitOverrides(mergedUnits, params.request.promptUnitOverrides);
    for (const unit of finalCompiledUnits) {
      if (!unit.enabled) continue;
      // 有些 override 会直接改 template，因此这里补一轮兜底渲染。
      if (!unit.renderedContent || unit.renderedContent === unit.contentTemplate) {
        unit.renderedContent = renderTemplate(unit.contentTemplate, vars);
      }
    }

    // 第五步：真正装配最终 messages，并计算整体 token 预算近似值。
    const assembled = assembleMessages(finalCompiledUnits);
    const finalMessages = assembled.finalMessages;
    const allText = finalMessages.map((msg) => msg.content).join("\n");
    const inputApprox = estimateTokensByChars(allText);

    const groupedUnitIds = new Map<PromptInsertionPoint, string[]>();
    for (const unit of finalCompiledUnits) {
      if (unit.source.kind !== "prompt_unit" && unit.source.kind !== "catalog_node") continue;
      if (unit.placement.mode !== "slot") continue;
      const list = groupedUnitIds.get(unit.placement.slot) ?? [];
      list.push(unit.source.kind === "catalog_node" ? unit.source.nodeId : unit.source.unitId);
      groupedUnitIds.set(unit.placement.slot, list);
    }

    // PromptAssemblyPlan 偏“完整复盘”；PromptTrace 偏“快速调试摘要”。
    const promptAssemblyPlan: PromptAssemblyPlan = {
      assemblyId: `asm_${compileId}`,
      agentId: params.agent.id,
      threadId: params.request.threadId,
      runId: params.request.runId,
      units: finalCompiledUnits.map((item) => ({
        id: item.id,
        source: item.source,
        enabled: item.enabled,
        role: item.role,
        contentTemplate: item.contentTemplate,
        renderedContent: item.renderedContent,
        placement: item.placement,
        sortWeight: item.sortWeight,
        metadata: item.metadata
      })),
      orderedUnitIds: assembled.orderedUnitIds,
      finalMessages,
      notes: assembled.notes
    };

    const compatSelectedBlocks: NonNullable<PromptTrace["selectedBlocks"]> = selectedUnits.map((unit) => ({
      blockId: unit.unitId,
      version: unit.version,
      insertionPoint: unit.insertionPoint,
      priority: unit.priority,
      reason: unit.reason,
      renderedTextPreview: unit.renderedTextPreview,
      tokenEstimate: unit.tokenEstimate
    }));
    const compatRejectedBlocks: NonNullable<PromptTrace["rejectedBlocks"]> = rejectedUnits.map((unit) => ({
      blockId: unit.unitId,
      version: unit.version,
      reason: unit.reason
    }));

    const promptTrace: PromptTrace = {
      compileId,
      agentId: params.agent.id,
      providerApiType: params.request.providerApiType,
      selectedUnits,
      rejectedUnits,
      renderedVariables,
      insertionPlan: ([
        "system_pre",
        "system_post",
        "developer",
        "memory_context",
        "tool_context",
        "task_pre",
        "task_post"
      ] as PromptInsertionPoint[]).map((insertionPoint) => ({
        insertionPoint,
        unitIds: groupedUnitIds.get(insertionPoint) ?? []
      })),
      selectedBlocks: compatSelectedBlocks,
      rejectedBlocks: compatRejectedBlocks,
      finalMessages,
      contextSliceSummary: {
        totalSources: params.request.contextSources.length,
        keptSources: sliced.kept.length,
        omittedSources: sliced.omitted.length,
        policyLabel: contextPolicyLabel
      },
      tokenEstimate: {
        inputApprox,
        outputReservedApprox: 800,
        totalApprox: inputApprox + 800
      },
      redactions: [],
      promptAssemblyPlan
    };

    return {
      finalMessages,
      promptTrace,
      tokenBudgetReport: {
        usedApprox: inputApprox,
        reservedOutputApprox: 800,
        droppedApprox: sliced.omitted.reduce((acc, item) => acc + estimateTokensByChars(item.content), 0)
      },
      omittedContextReport: sliced.omittedReport
    };
  }
}
