/**
 * 本文件作用：
 * - 标准化 `request_user_input` 内置工具的请求 payload。
 *
 * 说明：
 * - 真正的 interrupt/resume 行为由 runtime 调用 LangGraph `interrupt()` 完成；
 * - 这里先做参数清洗与统一结构产出，便于后续路由层复用。
 */

import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue, UserInputRequestState } from "../../../types/index.js";

export function buildUserInputRequestState(args: JsonObject): { ok: true; state: UserInputRequestState; payload: JsonValue } | { ok: false; error: JsonValue } {
  const rawQuestions = args.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return {
      ok: false,
      error: { code: "INVALID_QUESTIONS", message: "`questions` 必须是非空数组" }
    };
  }

  const questions = rawQuestions.map((q, idx) => {
    const row = (q ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id ?? `q_${idx + 1}`),
      question: String(row.question ?? "").trim(),
      options: Array.isArray(row.options)
        ? row.options.map((opt) => {
            const o = (opt ?? {}) as Record<string, unknown>;
            return {
              label: String(o.label ?? ""),
              description: o.description == null ? undefined : String(o.description)
            };
          })
        : undefined
    };
  });

  if (questions.some((q) => !q.question)) {
    return {
      ok: false,
      error: { code: "EMPTY_QUESTION", message: "questions 中存在空 question" }
    };
  }

  const requestId = `uireq_${randomUUID().replace(/-/g, "")}`;
  const requestedAt = new Date().toISOString();
  const mode = String(args.mode ?? "freeform");
  const normalizedQuestionsForJson = questions.map((q) => ({
    id: q.id,
    question: q.question,
    ...(q.options ? { options: q.options.map((opt) => ({
      label: opt.label,
      ...(opt.description ? { description: opt.description } : {})
    })) } : {})
  }));

  const state: UserInputRequestState = {
    requestId,
    status: "waiting",
    questions,
    requestedAt
  };
  return {
    ok: true,
    state,
    payload: {
      requestId,
      mode: mode === "single" || mode === "multi" ? mode : "freeform",
      questions: normalizedQuestionsForJson
    } as JsonValue
  };
}
