/**
 * 本文件作用：
 * - 实现 PromptBlock 编译器（首版最小可用实现）。
 * - 支持：触发判断、变量渲染、插槽插入、上下文裁剪摘要、PromptTrace 生成。
 *
 * 教学说明：
 * - 这里不是“单一 system prompt 拼接器”，而是一个有结构的装配流水线。
 * - 先做清晰可调试版本，再做复杂 token 精算与高级表达式引擎。
 */

import { randomUUID } from "node:crypto";
import type {
  AgentSpec,
  PromptBlock,
  PromptCompileRequest,
  PromptCompileResult,
  PromptInsertionPoint,
  PromptOverridePatch,
  PromptTrace,
  UnifiedMessage
} from "../../types/index.js";

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/**
 * 极简 token 估算（首版）：
 * - 用字符数粗略估算，目的是提供调试参考，而非计费精度。
 */
function estimateTokensByChars(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function shouldBlockApply(block: PromptBlock, req: PromptCompileRequest): { ok: boolean; reason: string } {
  if (!block.enabled) {
    return { ok: false, reason: "block disabled" };
  }

  const trigger = block.trigger;
  if (!trigger) {
    return { ok: true, reason: "no trigger (default include)" };
  }

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
      ...req.contextSources.slice(0, 10).map((item) => item.content)
    ]
      .join("\n")
      .toLowerCase();
    const hit = trigger.keywords.some((kw) => mergedText.includes(kw.toLowerCase()));
    if (!hit) {
      return { ok: false, reason: "keyword not matched" };
    }
  }

  // expression 暂不实现复杂解析；保留字段并给出明确说明，避免误会已生效。
  if (trigger.expression) {
    return { ok: true, reason: "expression present but skipped in v0.1 (accepted)" };
  }

  return { ok: true, reason: "trigger matched" };
}

function buildVars(req: PromptCompileRequest): Record<string, string> {
  const toolNames = req.toolSchemas.map((tool) => tool.toolName).join(", ") || "（无）";
  return {
    taskType: req.taskEnvelope.taskType,
    userInput: String(req.taskEnvelope.input.userInput ?? req.taskEnvelope.input.input ?? ""),
    toolNames
  };
}

function applyOverridePatches(blocks: PromptBlock[], patches: PromptOverridePatch[] | undefined): PromptBlock[] {
  if (!patches || patches.length === 0) return blocks;
  const map = new Map(blocks.map((item) => [item.id, { ...item }]));

  for (const patch of patches) {
    if (patch.type === "disable_block" && patch.targetBlockId) {
      const target = map.get(patch.targetBlockId);
      if (target) target.enabled = false;
    }

    if (patch.type === "replace_block_template" && patch.targetBlockId) {
      const target = map.get(patch.targetBlockId);
      const template = patch.payload.template;
      if (target && typeof template === "string") {
        target.template = template;
      }
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
 * Prompt 编译器主类。
 * 输入：
 * - AgentSpec（用于 agent 特定策略，首版仅用于 trace 展示）
 * - PromptBlocks（来自配置 + MemoryAdapter）
 * - PromptCompileRequest（运行时上下文）
 * 输出：
 * - 最终 messages
 * - PromptTrace
 */
export class PromptCompiler {
  compile(params: {
    agent: AgentSpec;
    blocks: PromptBlock[];
    request: PromptCompileRequest;
    contextPolicyLabel?: string;
  }): PromptCompileResult {
    const compileId = `pc_${randomUUID().replace(/-/g, "")}`;
    const contextPolicyLabel = params.contextPolicyLabel ?? "context.default(v0.1)";
    const blocksAfterOverride = applyOverridePatches(params.blocks, params.request.overridePatches);
    const vars = buildVars(params.request);

    const selected: PromptTrace["selectedBlocks"] = [];
    const rejected: PromptTrace["rejectedBlocks"] = [];
    const renderedVariables: PromptTrace["renderedVariables"] = [];
    const grouped = new Map<PromptInsertionPoint, Array<{ block: PromptBlock; rendered: string }>>();
    const omittedContextReport: PromptCompileResult["omittedContextReport"] = [];

    for (const block of blocksAfterOverride) {
      const verdict = shouldBlockApply(block, params.request);
      if (!verdict.ok) {
        rejected.push({
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

      selected.push({
        blockId: block.id,
        version: block.version,
        insertionPoint: block.insertionPoint,
        priority: block.priority,
        reason: verdict.reason,
        renderedTextPreview: rendered.slice(0, 200),
        tokenEstimate: estimateTokensByChars(rendered)
      });

      const bucket = grouped.get(block.insertionPoint) ?? [];
      bucket.push({ block, rendered });
      grouped.set(block.insertionPoint, bucket);
    }

    // 按插槽内 priority 排序（大优先级先）。
    for (const [point, list] of grouped) {
      list.sort((a, b) => b.block.priority - a.block.priority);
      grouped.set(point, list);
    }

    /**
     * 首版上下文裁剪策略（简单但可解释）：
     * - 保留最近若干条 contextSources 与 memoryInputs。
     * - 被裁掉的条目进入 omittedContextReport，供调试器显示。
     */
    const keptContext = params.request.contextSources.slice(-6);
    const omittedContext = params.request.contextSources.slice(0, -6);
    for (const source of omittedContext) {
      omittedContextReport.push({
        sourceId: source.id,
        reason: "v0.1 keep recent 6 context sources"
      });
    }

    const systemParts = [
      ...(grouped.get("system_pre") ?? []).map((item) => item.rendered),
      ...(grouped.get("system_post") ?? []).map((item) => item.rendered)
    ].filter(Boolean);
    const developerParts = [
      ...(grouped.get("developer") ?? []).map((item) => item.rendered),
      ...(grouped.get("tool_context") ?? []).map((item) => item.rendered)
    ].filter(Boolean);
    const taskParts = [
      ...(grouped.get("task_pre") ?? []).map((item) => item.rendered),
      `任务 JSON:\n${JSON.stringify(params.request.taskEnvelope.input, null, 2)}`,
      ...(grouped.get("task_post") ?? []).map((item) => item.rendered)
    ].filter(Boolean);
    const memoryParts = [
      ...(grouped.get("memory_context") ?? []).map((item) => item.rendered),
      ...params.request.memoryInputs.slice(0, 8).map((item) => `记忆(${item.adapterId}): ${item.content}`)
    ].filter(Boolean);

    const finalMessages: UnifiedMessage[] = [];
    if (systemParts.length > 0) {
      finalMessages.push({
        role: "system",
        content: systemParts.join("\n\n")
      });
    }
    if (developerParts.length > 0) {
      finalMessages.push({
        role: "developer",
        content: developerParts.join("\n\n")
      });
    }
    if (memoryParts.length > 0) {
      finalMessages.push({
        role: "developer",
        content: `记忆与世界书上下文：\n${memoryParts.join("\n\n")}`
      });
    }

    for (const source of keptContext) {
      finalMessages.push({
        role: "developer",
        content: `[上下文片段:${source.type}] ${source.content}`,
        metadata: { sourceId: source.id }
      });
    }

    finalMessages.push({
      role: "user",
      content: taskParts.join("\n\n")
    });

    const allText = finalMessages.map((msg) => msg.content).join("\n");
    const inputApprox = estimateTokensByChars(allText);

    const promptTrace: PromptTrace = {
      compileId,
      agentId: params.agent.id,
      providerApiType: params.request.providerApiType,
      selectedBlocks: selected,
      rejectedBlocks: rejected,
      renderedVariables,
      insertionPlan: (["system_pre", "system_post", "developer", "memory_context", "tool_context", "task_pre", "task_post"] as PromptInsertionPoint[]).map(
        (insertionPoint) => ({
          insertionPoint,
          blockIds: (grouped.get(insertionPoint) ?? []).map((item) => item.block.id)
        })
      ),
      finalMessages,
      contextSliceSummary: {
        totalSources: params.request.contextSources.length,
        keptSources: keptContext.length,
        omittedSources: omittedContext.length,
        policyLabel: contextPolicyLabel
      },
      tokenEstimate: {
        inputApprox,
        outputReservedApprox: 800,
        totalApprox: inputApprox + 800
      },
      redactions: []
    };

    return {
      finalMessages,
      promptTrace,
      tokenBudgetReport: {
        usedApprox: inputApprox,
        reservedOutputApprox: 800,
        droppedApprox: omittedContext.reduce((acc, item) => acc + estimateTokensByChars(item.content), 0)
      },
      omittedContextReport
    };
  }
}

