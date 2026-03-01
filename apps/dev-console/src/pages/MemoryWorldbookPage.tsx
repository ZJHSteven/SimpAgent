/**
 * 本文件作用：
 * - Memory & Worldbook 页面：查看 run 的状态差异、副作用、计划状态。
 * - 世界书在当前后端形态下由 PromptBlock/Config 管理，因此该页重点放在“运行时观察”。
 */

import { useState } from "react";
import { apiClient } from "../lib/apiClient";
import { pretty } from "../lib/utils";
import type { JsonValue } from "../types";

export function MemoryWorldbookPage() {
  const [runId, setRunId] = useState<string>("");
  const [stateDiffs, setStateDiffs] = useState<JsonValue[]>([]);
  const [sideEffects, setSideEffects] = useState<JsonValue[]>([]);
  const [runPlan, setRunPlan] = useState<JsonValue | null>(null);
  const [message, setMessage] = useState<string>("");

  async function loadRunArtifacts(): Promise<void> {
    if (!runId.trim()) {
      setMessage("请先输入 runId");
      return;
    }
    const [diffResp, sfxResp, planResp] = await Promise.all([
      apiClient.get<JsonValue[]>(`/api/runs/${runId}/state-diffs?limit=200`),
      apiClient.get<JsonValue[]>(`/api/runs/${runId}/side-effects?limit=200`),
      apiClient.get<JsonValue | null>(`/api/runs/${runId}/plan`)
    ]);
    if (diffResp.ok && Array.isArray(diffResp.data)) setStateDiffs(diffResp.data);
    if (sfxResp.ok && Array.isArray(sfxResp.data)) setSideEffects(sfxResp.data);
    if (planResp.ok) setRunPlan(planResp.data ?? null);
    if (!diffResp.ok || !sfxResp.ok) {
      setMessage(diffResp.message ?? sfxResp.message ?? "读取失败");
    } else {
      setMessage("已刷新运行时记忆/副作用视图");
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <h2>Memory & Worldbook</h2>
        <p>观察记忆相关副作用与状态演化；世界书入口在 Agent Studio 的 PromptBlock 中配置。</p>
      </header>

      <article className="panel">
        <div className="form-row">
          <label>
            Run ID
            <input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="run_xxx" />
          </label>
          <button onClick={() => void loadRunArtifacts()}>加载运行态数据</button>
        </div>
        {message ? <p className="hint">{message}</p> : null}
      </article>

      <div className="panel-grid three">
        <article className="panel">
          <h3>State Diffs</h3>
          <pre>{pretty(stateDiffs)}</pre>
        </article>
        <article className="panel">
          <h3>Side Effects</h3>
          <pre>{pretty(sideEffects)}</pre>
        </article>
        <article className="panel">
          <h3>Run Plan</h3>
          <pre>{pretty(runPlan)}</pre>
        </article>
      </div>
    </section>
  );
}

