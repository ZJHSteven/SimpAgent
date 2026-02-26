/**
 * 本文件作用：
 * - 实现 `update_plan` 内置工具执行器的参数校验与标准化。
 *
 * 说明：
 * - 真正写入数据库由 runtime / ToolRouter 集成时调用 AppDatabase.upsertRunPlan 完成；
 * - 本函数先负责保证 plan 结构合法（尤其最多一个 in_progress）。
 */

import type { JsonObject, JsonValue, PlanState } from "../../../types/index.js";

export function normalizeAndValidatePlan(args: JsonObject): { ok: true; plan: PlanState } | { ok: false; error: JsonValue } {
  const rawPlan = args.plan;
  if (!Array.isArray(rawPlan)) {
    return {
      ok: false,
      error: { code: "INVALID_PLAN", message: "`plan` 必须是数组" }
    };
  }

  const items: PlanState["items"] = rawPlan.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const step = String(row.step ?? "").trim();
    const status = String(row.status ?? "pending") as PlanState["items"][number]["status"];
    return {
      step,
      status: status === "in_progress" || status === "completed" ? status : "pending"
    };
  });

  if (items.some((item) => !item.step)) {
    return {
      ok: false,
      error: { code: "INVALID_PLAN_ITEM", message: "plan 中存在空 step" }
    };
  }

  const inProgressCount = items.filter((item) => item.status === "in_progress").length;
  if (inProgressCount > 1) {
    return {
      ok: false,
      error: {
        code: "PLAN_MULTIPLE_IN_PROGRESS",
        message: "计划中最多只能有一个 in_progress"
      }
    };
  }

  return {
    ok: true,
    plan: {
      explanation: args.explanation == null ? undefined : String(args.explanation),
      items,
      lastUpdatedAt: new Date().toISOString()
    }
  };
}

