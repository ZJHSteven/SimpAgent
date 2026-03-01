/**
 * 本文件作用：
 * - Trace Inspector 页面：查询 trace 事件与 prompt 编译详情。
 * - 覆盖接口：events / prompt compile / state-diffs / side-effects / plan。
 */

import { useState } from "react";
import { apiClient } from "../lib/apiClient";
import { pretty } from "../lib/utils";
import type { JsonValue, TraceEventDTO } from "../types";

export function TraceInspectorPage() {
  const [runId, setRunId] = useState<string>("");
  const [compileId, setCompileId] = useState<string>("");
  const [events, setEvents] = useState<TraceEventDTO[]>([]);
  const [promptCompile, setPromptCompile] = useState<JsonValue | null>(null);
  const [stateDiffs, setStateDiffs] = useState<JsonValue[]>([]);
  const [sideEffects, setSideEffects] = useState<JsonValue[]>([]);
  const [plan, setPlan] = useState<JsonValue | null>(null);
  const [message, setMessage] = useState<string>("");

  async function loadTraceBundle(): Promise<void> {
    if (!runId.trim()) {
      setMessage("请先输入 runId");
      return;
    }
    const [eventsResp, stateResp, sfxResp, planResp] = await Promise.all([
      apiClient.get<TraceEventDTO[]>(`/api/trace/${runId}/events?afterSeq=0&limit=1000`),
      apiClient.get<JsonValue[]>(`/api/runs/${runId}/state-diffs?limit=200`),
      apiClient.get<JsonValue[]>(`/api/runs/${runId}/side-effects?limit=200`),
      apiClient.get<JsonValue | null>(`/api/runs/${runId}/plan`)
    ]);
    if (eventsResp.ok && Array.isArray(eventsResp.data)) setEvents(eventsResp.data);
    if (stateResp.ok && Array.isArray(stateResp.data)) setStateDiffs(stateResp.data);
    if (sfxResp.ok && Array.isArray(sfxResp.data)) setSideEffects(sfxResp.data);
    if (planResp.ok) setPlan(planResp.data ?? null);
    setMessage(eventsResp.ok ? "trace bundle 已加载" : `加载失败：${eventsResp.message ?? "未知错误"}`);
  }

  async function loadPromptCompile(): Promise<void> {
    if (!runId.trim() || !compileId.trim()) {
      setMessage("请填写 runId 与 compileId");
      return;
    }
    const resp = await apiClient.get<JsonValue>(`/api/trace/${runId}/prompt/${compileId}`);
    if (!resp.ok) {
      setMessage(`读取 prompt compile 失败：${resp.message ?? "未知错误"}`);
      return;
    }
    setPromptCompile(resp.data ?? null);
    setMessage("prompt compile 已加载");
  }

  return (
    <section className="page">
      <header className="page-header">
        <h2>Trace Inspector</h2>
        <p>审计 run 过程：事件流、提示词装配结果、状态差异、副作用、计划。</p>
      </header>

      <article className="panel">
        <div className="form-grid">
          <label>
            Run ID
            <input value={runId} onChange={(e) => setRunId(e.target.value)} />
          </label>
          <label>
            Compile ID
            <input value={compileId} onChange={(e) => setCompileId(e.target.value)} />
          </label>
        </div>
        <div className="row-buttons">
          <button onClick={() => void loadTraceBundle()}>加载 Trace Bundle</button>
          <button onClick={() => void loadPromptCompile()}>加载 Prompt Compile</button>
        </div>
        {message ? <p className="hint">{message}</p> : null}
      </article>

      <div className="panel-grid two">
        <article className="panel">
          <h3>Trace Events</h3>
          <pre>{pretty(events)}</pre>
        </article>
        <article className="panel">
          <h3>Prompt Compile</h3>
          <pre>{pretty(promptCompile)}</pre>
        </article>
      </div>

      <div className="panel-grid two">
        <article className="panel">
          <h3>State Diffs</h3>
          <pre>{pretty(stateDiffs)}</pre>
        </article>
        <article className="panel">
          <h3>Side Effects</h3>
          <pre>{pretty(sideEffects)}</pre>
        </article>
      </div>

      <article className="panel">
        <h3>Run Plan</h3>
        <pre>{pretty(plan)}</pre>
      </article>
    </section>
  );
}

