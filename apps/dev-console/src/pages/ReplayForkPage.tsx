/**
 * 本文件作用：
 * - Replay & Fork 页面：查看线程历史、选择 checkpoint、执行分叉。
 * - 并提供 state/prompt 补丁接口入口，支持审计性实验。
 */

import { useState } from "react";
import { apiClient } from "../lib/apiClient";
import { pretty, safeParseJson } from "../lib/utils";
import type { JsonValue } from "../types";

export function ReplayForkPage() {
  const [threadId, setThreadId] = useState<string>("");
  const [history, setHistory] = useState<JsonValue[]>([]);
  const [checkpointId, setCheckpointId] = useState<string>("");
  const [reason, setReason] = useState<string>("实验分叉");
  const [patchJson, setPatchJson] = useState<string>("{\"flags\":{\"pauseRequested\":false}}");
  const [promptPatchJson, setPromptPatchJson] = useState<string>(
    "[{\"patchId\":\"p1\",\"type\":\"insert_ad_hoc_block\",\"payload\":{\"text\":\"临时提示\"}}]"
  );
  const [promptUnitPatchJson, setPromptUnitPatchJson] = useState<string>(
    "[{\"overrideId\":\"u1\",\"unitId\":\"msg_1\",\"action\":\"replace_content\",\"payload\":{\"content\":\"临时替换\"}}]"
  );
  const [result, setResult] = useState<JsonValue | null>(null);
  const [message, setMessage] = useState<string>("");

  async function loadHistory(): Promise<void> {
    if (!threadId.trim()) {
      setMessage("请先输入 threadId");
      return;
    }
    const resp = await apiClient.get<JsonValue[]>(`/api/threads/${threadId}/history`);
    if (!resp.ok || !Array.isArray(resp.data)) {
      setMessage(`读取历史失败：${resp.message ?? "未知错误"}`);
      return;
    }
    setHistory(resp.data);
    setMessage(`已加载历史，共 ${resp.data.length} 条`);
  }

  async function forkFromCheckpoint(): Promise<void> {
    if (!threadId.trim() || !checkpointId.trim()) {
      setMessage("请先填写 threadId 与 checkpointId");
      return;
    }
    const resp = await apiClient.post<JsonValue>(`/api/threads/${threadId}/checkpoints/${checkpointId}/fork`, {
      reason,
      resumeMode: "auto"
    });
    setResult(resp.data ?? null);
    setMessage(resp.ok ? "分叉成功" : `分叉失败：${resp.message ?? "未知错误"}`);
  }

  async function applyStatePatch(): Promise<void> {
    if (!threadId.trim() || !checkpointId.trim()) {
      setMessage("请先填写 threadId 与 checkpointId");
      return;
    }
    const patch = safeParseJson(patchJson);
    const resp = await apiClient.post<JsonValue>(`/api/threads/${threadId}/checkpoints/${checkpointId}/state-patch`, {
      reason,
      patch
    });
    setResult(resp.data ?? null);
    setMessage(resp.ok ? "state patch 已提交" : `state patch 失败：${resp.message ?? "未知错误"}`);
  }

  async function applyPromptOverrides(): Promise<void> {
    if (!threadId.trim() || !checkpointId.trim()) {
      setMessage("请先填写 threadId 与 checkpointId");
      return;
    }
    const patches = safeParseJson(promptPatchJson);
    const resp = await apiClient.post<JsonValue>(
      `/api/threads/${threadId}/checkpoints/${checkpointId}/prompt-overrides`,
      {
        reason,
        patches: Array.isArray(patches) ? patches : []
      }
    );
    setResult(resp.data ?? null);
    setMessage(resp.ok ? "prompt overrides 已提交" : `prompt overrides 失败：${resp.message ?? "未知错误"}`);
  }

  async function applyPromptUnitOverrides(): Promise<void> {
    if (!threadId.trim() || !checkpointId.trim()) {
      setMessage("请先填写 threadId 与 checkpointId");
      return;
    }
    const overrides = safeParseJson(promptUnitPatchJson);
    const resp = await apiClient.post<JsonValue>(
      `/api/threads/${threadId}/checkpoints/${checkpointId}/prompt-unit-overrides`,
      {
        reason,
        overrides: Array.isArray(overrides) ? overrides : []
      }
    );
    setResult(resp.data ?? null);
    setMessage(resp.ok ? "prompt unit overrides 已提交" : `prompt unit overrides 失败：${resp.message ?? "未知错误"}`);
  }

  return (
    <section className="page">
      <header className="page-header">
        <h2>Replay & Fork</h2>
        <p>围绕 checkpoint 做分叉实验：历史回放、状态补丁、提示词补丁、分叉运行。</p>
      </header>

      <article className="panel">
        <div className="form-grid">
          <label>
            Thread ID
            <input value={threadId} onChange={(e) => setThreadId(e.target.value)} />
          </label>
          <label>
            Checkpoint ID
            <input value={checkpointId} onChange={(e) => setCheckpointId(e.target.value)} />
          </label>
          <label>
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <div className="row-buttons">
          <button onClick={() => void loadHistory()}>加载历史</button>
          <button onClick={() => void forkFromCheckpoint()}>执行 Fork</button>
          <button onClick={() => void applyStatePatch()}>提交 State Patch</button>
          <button onClick={() => void applyPromptOverrides()}>提交 Prompt Overrides</button>
          <button onClick={() => void applyPromptUnitOverrides()}>提交 PromptUnit Overrides</button>
        </div>
        {message ? <p className="hint">{message}</p> : null}
      </article>

      <div className="panel-grid two">
        <article className="panel">
          <h3>Thread History</h3>
          <div className="list">
            {history.map((row, index) => {
              const cp = String((row as Record<string, unknown>).checkpointId ?? "");
              return (
                <button key={`${cp}_${index}`} className="list-item" onClick={() => setCheckpointId(cp)}>
                  <strong>{cp || "(无 checkpointId)"}</strong>
                  <small>{String((row as Record<string, unknown>).createdAt ?? "-")}</small>
                </button>
              );
            })}
          </div>
          <pre>{pretty(history)}</pre>
        </article>

        <article className="panel">
          <h3>Patch 草稿</h3>
          <label>
            State Patch JSON
            <textarea className="mono" rows={6} value={patchJson} onChange={(e) => setPatchJson(e.target.value)} />
          </label>
          <label>
            Prompt Overrides JSON
            <textarea className="mono" rows={6} value={promptPatchJson} onChange={(e) => setPromptPatchJson(e.target.value)} />
          </label>
          <label>
            PromptUnit Overrides JSON
            <textarea
              className="mono"
              rows={6}
              value={promptUnitPatchJson}
              onChange={(e) => setPromptUnitPatchJson(e.target.value)}
            />
          </label>
          <h4>最近结果</h4>
          <pre>{pretty(result)}</pre>
        </article>
      </div>
    </section>
  );
}

