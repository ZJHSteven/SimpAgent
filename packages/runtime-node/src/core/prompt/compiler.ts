/**
 * 本文件作用：
 * - 实现 Prompt 编译器（v0.2）：从 PromptBlock/历史/记忆构建 PromptUnit，
 *   再按 Placement 规则装配为最终 messages。
 * - 产出完整 PromptTrace（含 PromptAssemblyPlan），支持调试器“完全可见”。
 *
 * 设计要点：
 * 1) memory/history/worldbook 都视为 PromptUnit，不设特权类型；
 * 2) 支持 run-scope PromptUnitOverride（启停、改角色、改位置、改内容、改排序）；
 * 3) 保留旧 block trace 字段，保证接口兼容。
 */

import { randomUUID } from "node:crypto";
import type {
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
} from "../../types/index.js";

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

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

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
  return {
    mode: "slot",
    slot: insertionPoint
  };
}

function shouldBlockApply(block: PromptBlock, req: PromptCompileRequest): { ok: boolean; reason: string } {
  if (!block.enabled) return { ok: false, reason: "block disabled" };
  const trigger = block.trigger;
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

  // v0.2 当前阶段：expression 字段只保留接口，不做 DSL 执行。
  if (trigger.expression) return { ok: true, reason: "expression accepted (not evaluated in v0.2)" };
  return { ok: true, reason: "trigger matched" };
}

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

function applyOverridePatches(blocks: PromptBlock[], patches: PromptOverridePatch[] | undefined): PromptBlock[] {
  if (!patches || patches.length === 0) return blocks;
  const map = new Map(blocks.map((item) => [item.id, { ...item }]));
  for (const patch of patches) {
    if (patch.type === "disable_block" && patch.targetBlockId) {
      const target = map.get(patch.targetBlockId);
      if (target) target.enabled = false;
      continue;
    }
    if (patch.type === "replace_block_template" && patch.targetBlockId) {
      const target = map.get(patch.targetBlockId);
      const template = patch.payload.template;
      if (target && typeof template === "string") target.template = template;
      continue;
    }
    if (patch.type === "insert_ad_hoc_block") {
      const adHoc: PromptBlock = {
        id: `adhoc.${patch.patchId}`,
        name: "AdHoc Debug Block",
        kind: "hidden_internal",
        template: String(patch.payload.template ?? ""),
        insertionPoint: (patch.payload.insertionPoint as PromptInsertionPoint) ?? "developer",
        priority: Number(patch.payload.priority ?? 999),
        enabled: true,
        version: 1
      };
      map.set(adHoc.id, adHoc);
    }
  }
  return [...map.values()];
}

/**
 * 上下文切片策略（v0.2 最小实现）：
 * - 先保留高重要度条目（importance >= 0.9）；
 * - 再按“最近优先”补齐到预算；
 * - 输出 omitted report，保证可解释。
 */
function sliceContextSources(req: PromptCompileRequest): {
  kept: PromptCompileRequest["contextSources"];
  omitted: PromptCompileRequest["contextSources"];
  omittedReport: PromptCompileResult["omittedContextReport"];
} {
  const budget = 8;
  const pinned = req.contextSources.filter((item) => (item.importance ?? 0) >= 0.9);
  const rest = req.contextSources.filter((item) => !pinned.includes(item));
  const kept = [...pinned];
  for (const item of rest.slice(-Math.max(0, budget - kept.length))) {
    kept.push(item);
  }
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

function applyPromptUnitOverrides(units: PromptUnit[], overrides: PromptUnitOverride[] | undefined): PromptUnit[] {
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

function baseOrderWeight(unit: PromptUnit): number {
  if (unit.placement.mode === "slot") return SLOT_ORDER[unit.placement.slot] ?? 500;
  if (unit.placement.mode === "before_role_anchor") return 50;
  if (unit.placement.mode === "after_role_anchor") return 950;
  if (unit.placement.mode === "before_message_id") return 480;
  if (unit.placement.mode === "after_message_id") return 520;
  return 1000;
}

function insertByRoleAnchor(records: MessageRecord[], unit: PromptUnit, notes: string[]): void {
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
      metadata: { promptUnitId: unit.id, source: unit.source.kind }
    });
    return;
  }
  const insertAt = placement.mode === "before_role_anchor" ? indices[0] : indices[indices.length - 1] + 1;
  records.splice(insertAt, 0, {
    unitId: unit.id,
    role: unit.role,
    content: unit.renderedContent,
    metadata: { promptUnitId: unit.id, source: unit.source.kind }
  });
}

function insertByMessageAnchor(records: MessageRecord[], unit: PromptUnit, notes: string[]): void {
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
      metadata: { promptUnitId: unit.id, source: unit.source.kind }
    });
    return;
  }
  const insertAt = placement.mode === "before_message_id" ? anchorIndex : anchorIndex + 1;
  records.splice(insertAt, 0, {
    unitId: unit.id,
    role: unit.role,
    content: unit.renderedContent,
    metadata: { promptUnitId: unit.id, source: unit.source.kind }
  });
}

function assembleMessages(units: PromptUnit[]): { finalMessages: UnifiedMessage[]; orderedUnitIds: string[]; notes: string[] } {
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
    metadata: {
      promptUnitId: unit.id,
      source: unit.source.kind
    }
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

export class PromptCompiler {
  compile(params: {
    agent: AgentSpec;
    blocks: PromptBlock[];
    request: PromptCompileRequest;
    contextPolicyLabel?: string;
  }): PromptCompileResult {
    const compileId = `pc_${randomUUID().replace(/-/g, "")}`;
    const contextPolicyLabel = params.contextPolicyLabel ?? "context.importance_recent(v0.2)";
    const vars = buildVars(params.request);
    const blocksAfterOverride = applyOverridePatches(params.blocks, params.request.overridePatches);

    const selectedBlocks: PromptTrace["selectedBlocks"] = [];
    const rejectedBlocks: PromptTrace["rejectedBlocks"] = [];
    const renderedVariables: PromptTrace["renderedVariables"] = [];

    // 1) 先把 block 转为 PromptUnit（与历史/记忆同层）。
    const blockUnits: PromptUnit[] = [];
    for (const block of blocksAfterOverride) {
      const verdict = shouldBlockApply(block, params.request);
      if (!verdict.ok) {
        rejectedBlocks.push({
          blockId: block.id,
          version: block.version,
          reason: verdict.reason
        });
        continue;
      }
      const rendered = renderTemplate(block.template, vars);
      for (const [key, value] of Object.entries(vars)) {
        if (block.template.includes(`{{${key}}}`)) {
          renderedVariables.push({
            blockId: block.id,
            variable: key,
            valuePreview: String(value).slice(0, 120)
          });
        }
      }
      selectedBlocks.push({
        blockId: block.id,
        version: block.version,
        insertionPoint: block.insertionPoint,
        priority: block.priority,
        reason: verdict.reason,
        renderedTextPreview: rendered.slice(0, 200),
        tokenEstimate: estimateTokensByChars(rendered)
      });

      blockUnits.push({
        id: `unit.block.${block.id}`,
        source: { kind: "prompt_block", blockId: block.id, blockVersion: block.version, promptKind: block.kind },
        enabled: true,
        role: block.insertionPoint.startsWith("system_") ? "system" : "developer",
        title: block.name,
        contentTemplate: block.template,
        renderedContent: rendered,
        variables: vars,
        placement: placementFromInsertionPoint(block.insertionPoint),
        sortWeight: block.priority,
        metadata: {
          reason: verdict.reason
        }
      });
    }

    // 2) 历史上下文也转为 PromptUnit，并产出 omitted report。
    const sliced = sliceContextSources(params.request);
    const historyUnits: PromptUnit[] = sliced.kept.map((item, idx) => {
      const roleHint = item.metadata?.role;
      const role: MessageRole = isMessageRole(roleHint) ? roleHint : "developer";
      return {
        id: `unit.history.${item.id}`,
        source: { kind: "history_message", messageIndex: idx, originalRole: role },
        enabled: true,
        role,
        title: `history:${item.id}`,
        contentTemplate: item.content,
        renderedContent: item.content,
        placement: { mode: "end" },
        sortWeight: Number(item.importance ?? 0),
        tags: item.tags,
        metadata: {
          sourceId: item.id,
          sourceType: item.type
        }
      };
    });

    // 3) 记忆输入转为 PromptUnit（同等地位，不做特权）。
    const memoryUnits: PromptUnit[] = params.request.memoryInputs.map((item, idx) => ({
      id: `unit.memory.${item.adapterId}.${idx + 1}`,
      source: { kind: "memory_delegate", adapterId: item.adapterId },
      enabled: true,
      role: "developer",
      title: `memory:${item.adapterId}`,
      contentTemplate: item.content,
      renderedContent: item.content,
      placement: { mode: "slot", slot: "memory_context" },
      sortWeight: Number(item.score ?? 0),
      metadata: item.metadata
    }));

    // 4) 工具目录摘要也做成 PromptUnit，便于后续做渐进披露。
    const toolCatalogUnit: PromptUnit = {
      id: "unit.tool_catalog.default",
      source: { kind: "tool_catalog", scope: "runtime_exposed" },
      enabled: params.request.toolSchemas.length > 0,
      role: "developer",
      title: "tool_catalog",
      contentTemplate: `当前可用工具：\n${params.request.toolSchemas.map((t) => `- ${t.toolName}: ${t.description}`).join("\n")}`,
      renderedContent:
        params.request.toolSchemas.length > 0
          ? `当前可用工具：\n${params.request.toolSchemas.map((t) => `- ${t.toolName}: ${t.description}`).join("\n")}`
          : undefined,
      placement: { mode: "slot", slot: "tool_context" },
      sortWeight: 10
    };

    // 5) 任务本体作为 PromptUnit（用户消息）。
    const taskUnit: PromptUnit = {
      id: "unit.task.payload",
      source: { kind: "manual_override", operator: "runtime_task_envelope" },
      enabled: true,
      role: "user",
      title: "task_envelope",
      contentTemplate: JSON.stringify(params.request.taskEnvelope.input, null, 2),
      renderedContent: `任务类型: ${params.request.taskEnvelope.taskType}\n任务输入:\n${JSON.stringify(params.request.taskEnvelope.input, null, 2)}`,
      placement: { mode: "slot", slot: "task_post" },
      sortWeight: 1000
    };

    const mergedUnits = [
      ...blockUnits,
      ...historyUnits,
      ...memoryUnits,
      toolCatalogUnit,
      taskUnit
    ];
    const finalUnits = applyPromptUnitOverrides(mergedUnits, params.request.promptUnitOverrides);

    // 覆盖后重新渲染 replace_content 场景（保证变量替换仍可用）。
    for (const unit of finalUnits) {
      if (!unit.enabled) continue;
      if (!unit.renderedContent || unit.renderedContent === unit.contentTemplate) {
        unit.renderedContent = renderTemplate(unit.contentTemplate, vars);
      }
    }

    const assembled = assembleMessages(finalUnits);
    const finalMessages = assembled.finalMessages;
    const allText = finalMessages.map((msg) => msg.content).join("\n");
    const inputApprox = estimateTokensByChars(allText);

    const groupedBlockIds = new Map<PromptInsertionPoint, string[]>();
    for (const unit of finalUnits) {
      if (unit.source.kind !== "prompt_block") continue;
      if (unit.placement.mode !== "slot") continue;
      const list = groupedBlockIds.get(unit.placement.slot) ?? [];
      list.push(unit.source.blockId);
      groupedBlockIds.set(unit.placement.slot, list);
    }

    const promptAssemblyPlan: PromptAssemblyPlan = {
      assemblyId: `asm_${compileId}`,
      agentId: params.agent.id,
      threadId: params.request.threadId,
      runId: params.request.runId,
      units: finalUnits,
      orderedUnitIds: assembled.orderedUnitIds,
      finalMessages,
      notes: assembled.notes
    };

    const promptTrace: PromptTrace = {
      compileId,
      agentId: params.agent.id,
      providerApiType: params.request.providerApiType,
      selectedBlocks,
      rejectedBlocks,
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
        blockIds: groupedBlockIds.get(insertionPoint) ?? []
      })),
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
