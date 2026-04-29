/**
 * 本文件实现第一版 PromptCompiler。
 *
 * 它只做最小但稳定的几件事：
 * - 按 binding.order 固定顺序拼接 prompt unit。
 * - 支持 {{变量名}} 这种直观变量替换。
 * - 支持 history 与 current_user_input 占位。
 * - 输出 assembly plan，方便后续写入 prompt_compilations 调试。
 */
import { createTextMessage, type ContextMessage, type ContextRole } from "../types/messages.js";
import type { IdGenerator, JsonObject, JsonValue } from "../types/common.js";
import { parseJsonArray, type PromptBindingDefinition } from "../preset/preset.js";

export interface PromptUnitDefinition {
  readonly nodeId: string;
  readonly role: ContextRole;
  readonly contentTemplate: string;
  readonly variables?: JsonObject;
}

export interface PromptCompileInput {
  readonly agentNodeId: string;
  readonly promptBindingJson: string;
  readonly promptUnits: readonly PromptUnitDefinition[];
  readonly history: readonly ContextMessage[];
  readonly currentUserInput: string;
  readonly variables?: JsonObject;
  readonly idGenerator: IdGenerator;
}

export interface PromptCompileResult {
  readonly messages: readonly ContextMessage[];
  readonly assemblyPlan: JsonObject;
  readonly trace: JsonObject;
}

/**
 * 判断字符串是否为 ContextRole。
 */
function toContextRole(value: string): ContextRole {
  if (
    value === "system" ||
    value === "developer" ||
    value === "user" ||
    value === "assistant" ||
    value === "tool" ||
    value === "thinking"
  ) {
    return value;
  }

  throw new Error(`不支持的 prompt role：${value}`);
}

/**
 * 将变量值转换成可拼接的文本。
 */
function variableToText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * 渲染 {{变量名}} 模板。
 */
function renderTemplate(template: string, variables: JsonObject): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, name: string) =>
    variableToText(variables[name])
  );
}

/**
 * 编译 agent 的模型上下文。
 */
export function compileAgentPrompt(input: PromptCompileInput): PromptCompileResult {
  const promptUnitsById = new Map(input.promptUnits.map((unit) => [unit.nodeId, unit]));
  const bindings = parseJsonArray<PromptBindingDefinition>(input.promptBindingJson)
    .filter((binding) => binding.enabled !== false)
    .sort((left, right) => left.order - right.order);
  const messages: ContextMessage[] = [];
  const usedBindings: JsonObject[] = [];

  for (const binding of bindings) {
    if (binding.kind === "prompt_unit") {
      if (binding.target_node_id === undefined) {
        throw new Error("prompt_unit binding 必须提供 target_node_id。");
      }

      const unit = promptUnitsById.get(binding.target_node_id);

      if (unit === undefined) {
        throw new Error(`找不到 prompt unit：${binding.target_node_id}`);
      }

      const variables = {
        ...(unit.variables ?? {}),
        ...(input.variables ?? {})
      };
      messages.push(
        createTextMessage({
          id: input.idGenerator.nextId(),
          role: unit.role,
          content: renderTemplate(unit.contentTemplate, variables),
          metadata: { source: "prompt_unit", promptUnitNodeId: unit.nodeId }
        })
      );
      usedBindings.push({ kind: binding.kind, order: binding.order, target_node_id: binding.target_node_id });
      continue;
    }

    if (binding.kind === "history") {
      messages.push(...input.history);
      usedBindings.push({ kind: binding.kind, order: binding.order, messageCount: input.history.length });
      continue;
    }

    if (binding.kind === "current_user_input") {
      messages.push(
        createTextMessage({
          id: input.idGenerator.nextId(),
          role: toContextRole(binding.role ?? "user"),
          content: input.currentUserInput,
          metadata: { source: "current_user_input" }
        })
      );
      usedBindings.push({ kind: binding.kind, order: binding.order });
      continue;
    }

    if (binding.kind === "runtime_variable") {
      const variableName = binding.variable_name;

      if (variableName === undefined) {
        throw new Error("runtime_variable binding 必须提供 variable_name。");
      }

      messages.push(
        createTextMessage({
          id: input.idGenerator.nextId(),
          role: toContextRole(binding.role ?? "system"),
          content: variableToText(input.variables?.[variableName]),
          metadata: { source: "runtime_variable", variableName }
        })
      );
      usedBindings.push({ kind: binding.kind, order: binding.order, variable_name: variableName });
    }
  }

  return {
    messages,
    assemblyPlan: {
      agentNodeId: input.agentNodeId,
      bindings: usedBindings
    },
    trace: {
      promptUnitCount: input.promptUnits.length,
      renderedMessageCount: messages.length,
      historyMessageCount: input.history.length
    }
  };
}
