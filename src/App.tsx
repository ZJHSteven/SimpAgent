/**
 * 本文件作用（v0.2 测试工作台前端）：
 * - 提供一个“白皮书风”的单页调试界面，用于联调 backend 的 run/trace/history/fork/工具配置接口。
 * - 重点覆盖：可观测性、断线重连、builtin tools、apply_patch dry-run、state diff / side effects。
 *
 * 教学说明（给初学者）：
 * 1. 这里是“测试工作台”，不是最终产品 UI，所以优先信息密度与调试能力，而不是花哨视觉。
 * 2. HTTP 用于“命令和查询”，WS 用于“实时 trace 事件”。
 * 3. 前端会尽量把后端返回的结构原样显示出来，便于你排查字段是否符合预期。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface ApiResp<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
  details?: unknown;
}

interface RunSummary {
  run_id: string;
  thread_id: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  current_node_id?: string | null;
}

interface TraceEvent {
  seq: number;
  eventId: string;
  runId: string;
  threadId: string;
  type: string;
  timestamp: string;
  nodeId?: string;
  agentId?: string;
  summary: string;
  payload?: JsonValue;
}

interface WsMessage {
  type: string;
  [k: string]: unknown;
}

interface BuiltinToolRow {
  name: string;
  toolId: string;
  description: string;
  runtimeConfig: {
    enabled: boolean;
    exposurePolicy: {
      preferredAdapter?: string;
      fallbackAdapters?: string[];
      exposureLevel: string;
      exposeByDefault: boolean;
    };
    permissionPolicy: {
      permissionProfileId: string;
      shellPermissionLevel?: string;
      timeoutMs?: number;
    };
  };
}

const BACKEND_HTTP_BASE = "http://localhost:3002";
const BACKEND_WS_URL = "ws://localhost:3002/ws";

async function apiGet<T>(path: string): Promise<ApiResp<T>> {
  const resp = await fetch(`${BACKEND_HTTP_BASE}${path}`);
  return (await resp.json()) as ApiResp<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<ApiResp<T>> {
  const resp = await fetch(`${BACKEND_HTTP_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  return (await resp.json()) as ApiResp<T>;
}

async function apiPut<T>(path: string, body?: unknown): Promise<ApiResp<T>> {
  const resp = await fetch(`${BACKEND_HTTP_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  return (await resp.json()) as ApiResp<T>;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function App() {
  /**
   * ===== 连接与运行状态 =====
   * 这些状态决定整个工作台的“当前上下文”。
   */
  const [runId, setRunId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const lastSeqByRunRef = useRef<Record<string, number>>({});

  /**
   * ===== 表单与调试输入 =====
   */
  const [workflowId, setWorkflowId] = useState("workflow.default");
  const [userInput, setUserInput] = useState("请演示一个带工具调用与审计 trace 的工作流。");
  const [providerVendor, setProviderVendor] = useState("mock");
  const [providerApiMode, setProviderApiMode] = useState<"chat_completions" | "responses">("responses");
  const [providerModel, setProviderModel] = useState("gpt-5-mini");
  const [toolProtocolProfile, setToolProtocolProfile] = useState(
    "auto" as
      | "auto"
      | "openai_responses"
      | "openai_chat_function"
      | "openai_chat_custom"
      | "openai_compat_function_only"
      | "structured_output_first"
      | "prompt_protocol_only"
  );
  const [historyRows, setHistoryRows] = useState<JsonValue[]>([]);
  const [stateDiffRows, setStateDiffRows] = useState<JsonValue[]>([]);
  const [sideEffectRows, setSideEffectRows] = useState<JsonValue[]>([]);
  const [runPlan, setRunPlan] = useState<JsonValue | null>(null);
  const [builtinTools, setBuiltinTools] = useState<BuiltinToolRow[]>([]);
  const [toolExposurePolicies, setToolExposurePolicies] = useState<JsonValue | null>(null);
  const [patchDryRunText, setPatchDryRunText] = useState(
    "*** Begin Patch\n*** Add File: tmp_demo.txt\n+hello from dry run\n*** End Patch"
  );
  const [patchDryRunResult, setPatchDryRunResult] = useState<JsonValue | null>(null);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState("");
  const [forkReason, setForkReason] = useState("前端测试分叉");
  const [resumePayloadText, setResumePayloadText] = useState("{\"answer\":\"继续执行\"}");
  const [globalMessage, setGlobalMessage] = useState<string>("");

  /**
   * ===== PromptUnit 调试占位数据 =====
   * 说明：
   * - 后端 PromptUnit 装配仍在逐步接入，这里先提供前端编辑体验壳子；
   * - 当 `/api/trace/.../prompt/...` 返回 `promptAssemblyPlan` 时会覆盖这里。
   */
  const [promptUnitsDraft, setPromptUnitsDraft] = useState<Array<{
    id: string;
    enabled: boolean;
    role: string;
    placement: string;
    sortWeight: number;
    content: string;
  }>>([]);

  /**
   * 追加 WS 日志（控制长度，避免浏览器内存持续增长）。
   */
  function appendWsLog(line: string) {
    setWsLogs((prev) => {
      const next = [...prev, `[${new Date().toLocaleTimeString()}] ${line}`];
      return next.slice(-120);
    });
  }

  function mergeTraceEvents(events: TraceEvent[]) {
    setTraceEvents((prev) => {
      const map = new Map<number, TraceEvent>();
      for (const item of prev) map.set(item.seq, item);
      for (const item of events) map.set(item.seq, item);
      const merged = [...map.values()].sort((a, b) => a.seq - b.seq);
      return merged.slice(-2000);
    });
    for (const event of events) {
      lastSeqByRunRef.current[event.runId] = Math.max(lastSeqByRunRef.current[event.runId] ?? 0, event.seq);
    }
  }

  /**
   * 建立/重建 WS 连接。
   * 说明：
   * - 连接成功后若已有 runId，会自动携带 lastEventSeq 订阅；
   * - 若收到 REPLAY_WINDOW_MISS，会回退到 HTTP 分页补拉。
   */
  function connectWs() {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    setWsStatus("connecting");
    appendWsLog("开始连接 WS");
    const ws = new WebSocket(BACKEND_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("open");
      appendWsLog("WS 已连接");
      ws.send(JSON.stringify({ type: "hello" }));
      if (runId) {
        const lastEventSeq = lastSeqByRunRef.current[runId] ?? 0;
        ws.send(JSON.stringify({ type: "subscribe_run", runId, lastEventSeq }));
        appendWsLog(`订阅 run=${runId}，lastEventSeq=${lastEventSeq}`);
      }
    };

    ws.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(String(evt.data)) as WsMessage;
        if (msg.type === "trace_event" && msg.event) {
          mergeTraceEvents([msg.event as TraceEvent]);
          return;
        }
        if (msg.type === "replay_events_batch" && Array.isArray(msg.events)) {
          mergeTraceEvents(msg.events as TraceEvent[]);
          appendWsLog(`收到补发事件 ${String((msg.events as TraceEvent[]).length)} 条`);
          return;
        }
        if (msg.type === "run_snapshot" && msg.snapshot && typeof msg.snapshot === "object") {
          appendWsLog(`收到 run_snapshot（latestTraceSeq=${String((msg.snapshot as any).latestTraceSeq ?? (msg.snapshot as any).traceEventSeqLast ?? 0)}）`);
          return;
        }
        if (msg.type === "warning") {
          appendWsLog(`WS warning: ${String(msg.code)} ${String(msg.message ?? "")}`);
          if (msg.code === "REPLAY_WINDOW_MISS" && runId) {
            await syncRunSnapshotAndTraceByHttp(runId);
          }
          return;
        }
        if (msg.type === "error") {
          appendWsLog(`WS error message: ${String(msg.code)} ${String(msg.message ?? "")}`);
          return;
        }
      } catch (error) {
        appendWsLog(`WS 消息解析失败：${error instanceof Error ? error.message : String(error)}`);
      }
    };

    ws.onerror = () => {
      setWsStatus("error");
      appendWsLog("WS onerror");
    };

    ws.onclose = () => {
      setWsStatus("closed");
      appendWsLog("WS 已关闭，准备自动重连");
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        connectWs();
      }, 1500);
    };
  }

  async function syncRunSnapshotAndTraceByHttp(targetRunId: string) {
    appendWsLog(`回退 HTTP 补拉 run=${targetRunId}`);
    const [runResp, traceResp] = await Promise.all([
      apiGet<RunSummary>(`/api/runs/${targetRunId}`),
      apiGet<TraceEvent[]>(
        `/api/trace/${targetRunId}/events?afterSeq=${lastSeqByRunRef.current[targetRunId] ?? 0}&limit=500`
      )
    ]);
    if (runResp.ok && runResp.data) setRunSummary(runResp.data);
    if (traceResp.ok && Array.isArray(traceResp.data)) mergeTraceEvents(traceResp.data);
  }

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
    // 这里故意只在首挂载执行一次，避免每次状态变化都重连 WS。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!runId || wsStatus !== "open" || !wsRef.current) return;
    const lastEventSeq = lastSeqByRunRef.current[runId] ?? 0;
    wsRef.current.send(JSON.stringify({ type: "subscribe_run", runId, lastEventSeq }));
    appendWsLog(`切换订阅 run=${runId}，lastEventSeq=${lastEventSeq}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, wsStatus]);

  /**
   * 初始加载工具策略与 builtin tools。
   */
  useEffect(() => {
    void (async () => {
      const [builtinResp, policyResp] = await Promise.all([
        apiGet<BuiltinToolRow[]>("/api/tools/builtin"),
        apiGet<JsonValue>("/api/config/tool-exposure-policies")
      ]);
      if (builtinResp.ok && Array.isArray(builtinResp.data)) setBuiltinTools(builtinResp.data);
      if (policyResp.ok) setToolExposurePolicies(policyResp.data ?? null);
    })();
  }, []);

  async function createRun() {
    setGlobalMessage("");
    const resp = await apiPost<{ runId: string; threadId: string; status: string }>("/api/runs", {
      workflowId,
      userInput,
      provider: {
        vendor: providerVendor,
        apiMode: providerApiMode,
        model: providerModel,
        toolProtocolProfile
      }
    });
    if (!resp.ok || !resp.data) {
      setGlobalMessage(`创建 run 失败：${resp.message ?? "未知错误"}`);
      return;
    }
    setRunId(resp.data.runId);
    setThreadId(resp.data.threadId);
    setTraceEvents([]);
    lastSeqByRunRef.current[resp.data.runId] = 0;
    setGlobalMessage(`已创建 run=${resp.data.runId}`);
    await refreshRunData(resp.data.runId, resp.data.threadId);
  }

  async function refreshRunData(targetRunId = runId, targetThreadId = threadId) {
    if (!targetRunId) return;
    const [runResp, diffResp, sfxResp, planResp] = await Promise.all([
      apiGet<RunSummary>(`/api/runs/${targetRunId}`),
      apiGet<JsonValue[]>(`/api/runs/${targetRunId}/state-diffs?limit=100`),
      apiGet<JsonValue[]>(`/api/runs/${targetRunId}/side-effects?limit=100`),
      apiGet<JsonValue>(`/api/runs/${targetRunId}/plan`)
    ]);
    if (runResp.ok && runResp.data) setRunSummary(runResp.data);
    if (diffResp.ok && Array.isArray(diffResp.data)) setStateDiffRows(diffResp.data);
    if (sfxResp.ok && Array.isArray(sfxResp.data)) setSideEffectRows(sfxResp.data);
    if (planResp.ok) setRunPlan(planResp.data ?? null);
    if (targetThreadId) {
      const histResp = await apiGet<JsonValue[]>(`/api/threads/${targetThreadId}/history`);
      if (histResp.ok && Array.isArray(histResp.data)) {
        setHistoryRows(histResp.data);
      }
    }
  }

  async function pauseRun() {
    if (!runId) return;
    await apiPost(`/api/runs/${runId}/pause`, { reason: "frontend_pause" });
    await refreshRunData();
  }

  async function interruptRun() {
    if (!runId) return;
    await apiPost(`/api/runs/${runId}/interrupt`, {
      reason: "frontend_interrupt",
      payload: { source: "workbench" }
    });
    await refreshRunData();
  }

  async function resumeRun() {
    if (!runId) return;
    let payload: unknown = undefined;
    try {
      payload = resumePayloadText.trim() ? JSON.parse(resumePayloadText) : undefined;
    } catch {
      payload = resumePayloadText;
    }
    await apiPost(`/api/runs/${runId}/resume`, { resumePayload: payload });
    await refreshRunData();
  }

  async function forkFromCheckpoint() {
    if (!threadId || !selectedCheckpointId) return;
    const resp = await apiPost<{ newRunId: string; threadId: string }>(
      `/api/threads/${threadId}/checkpoints/${selectedCheckpointId}/fork`,
      { reason: forkReason, resumeMode: "auto" }
    );
    if (resp.ok && resp.data) {
      setRunId(resp.data.newRunId);
      setThreadId(resp.data.threadId);
      setGlobalMessage(`已创建 fork run=${resp.data.newRunId}`);
      await refreshRunData(resp.data.newRunId, resp.data.threadId);
    } else {
      setGlobalMessage(`fork 失败：${resp.message ?? "未知错误"}`);
    }
  }

  async function runApplyPatchDryRun() {
    const resp = await apiPost<JsonValue>("/api/tools/apply-patch/dry-run", {
      patch: patchDryRunText
    });
    if (resp.ok) {
      setPatchDryRunResult(resp.data ?? null);
    } else {
      setPatchDryRunResult({ ok: false, message: resp.message ?? "dry-run 失败" });
    }
  }

  async function refreshBuiltinTools() {
    const resp = await apiGet<BuiltinToolRow[]>("/api/tools/builtin");
    if (resp.ok && Array.isArray(resp.data)) setBuiltinTools(resp.data);
  }

  async function toggleBuiltinTool(name: string, enabled: boolean) {
    await apiPut(`/api/tools/builtin/${name}`, { enabled });
    await refreshBuiltinTools();
  }

  async function changeBuiltinExposure(name: string, preferredAdapter: string) {
    await apiPut(`/api/tools/builtin/${name}`, {
      exposurePolicy: { preferredAdapter }
    });
    await refreshBuiltinTools();
  }

  const sortedTraceEvents = useMemo(() => [...traceEvents].sort((a, b) => a.seq - b.seq), [traceEvents]);
  const traceCountByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const evt of sortedTraceEvents) {
      map.set(evt.type, (map.get(evt.type) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [sortedTraceEvents]);

  async function loadPromptCompileByEvent(event: TraceEvent) {
    const compileId = (event.payload as any)?.compileId;
    if (!compileId || !runId) return;
    const resp = await apiGet<{ promptTrace?: any; finalMessages?: any[] }>(`/api/trace/${runId}/prompt/${compileId}`);
    if (!resp.ok || !resp.data) return;
    const plan = (resp.data as any)?.promptTrace?.promptAssemblyPlan;
    if (plan?.units && Array.isArray(plan.units)) {
      setPromptUnitsDraft(
        plan.units.map((u: any) => ({
          id: String(u.id),
          enabled: Boolean(u.enabled),
          role: String(u.role ?? "developer"),
          placement: pretty(u.placement),
          sortWeight: Number(u.sortWeight ?? 0),
          content: String(u.renderedContent ?? u.contentTemplate ?? "")
        }))
      );
    } else if (Array.isArray(resp.data.finalMessages)) {
      // 后端 PromptUnit 尚未完全接入时，用 finalMessages 生成一个可编辑草稿占位。
      setPromptUnitsDraft(
        resp.data.finalMessages.map((m: any, idx: number) => ({
          id: `msg_${idx + 1}`,
          enabled: true,
          role: String(m.role ?? "developer"),
          placement: "end",
          sortWeight: idx,
          content: String(m.content ?? "")
        }))
      );
    }
  }

  return (
    <div className="workbench">
      <header className="wb-header">
        <div>
          <h1>Observable Agent Workbench</h1>
          <p>v0.2 测试前端（白皮书风）: 测 run / trace / history / fork / builtin tools / apply_patch dry-run</p>
        </div>
        <div className="status-strip">
          <span className={`pill ws-${wsStatus}`}>WS: {wsStatus}</span>
          <span className="pill">run: {runId || "-"}</span>
          <span className="pill">thread: {threadId || "-"}</span>
        </div>
      </header>

      {globalMessage ? <div className="banner">{globalMessage}</div> : null}

      <div className="wb-grid">
        <section className="panel left">
          <h2>Run 控制</h2>
          <label>
            Workflow ID
            <input value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} />
          </label>
          <label>
            User Input
            <textarea value={userInput} onChange={(e) => setUserInput(e.target.value)} rows={4} />
          </label>
          <div className="row">
            <label>
              Vendor
              <select value={providerVendor} onChange={(e) => setProviderVendor(e.target.value)}>
                <option value="mock">mock</option>
                <option value="openai">openai</option>
                <option value="gemini_openai_compat">gemini_openai_compat</option>
                <option value="generic_openai_compat">generic_openai_compat</option>
              </select>
            </label>
            <label>
              API Mode
              <select
                value={providerApiMode}
                onChange={(e) => setProviderApiMode(e.target.value as "chat_completions" | "responses")}
              >
                <option value="responses">responses</option>
                <option value="chat_completions">chat_completions</option>
              </select>
            </label>
            <label>
              Model
              <input value={providerModel} onChange={(e) => setProviderModel(e.target.value)} />
            </label>
          </div>
          <label>
            Tool Protocol Profile（模型路由工具协议画像，决定内层暴露适配层）
            <select value={toolProtocolProfile} onChange={(e) => setToolProtocolProfile(e.target.value as any)}>
              <option value="auto">auto（按 vendor/apiMode 自动判断）</option>
              <option value="openai_responses">openai_responses</option>
              <option value="openai_chat_function">openai_chat_function</option>
              <option value="openai_chat_custom">openai_chat_custom</option>
              <option value="openai_compat_function_only">openai_compat_function_only</option>
              <option value="structured_output_first">structured_output_first</option>
              <option value="prompt_protocol_only">prompt_protocol_only</option>
            </select>
          </label>
          <div className="button-row">
            <button onClick={createRun}>创建 Run</button>
            <button onClick={() => refreshRunData()} disabled={!runId}>
              刷新摘要
            </button>
            <button onClick={pauseRun} disabled={!runId}>
              Pause
            </button>
            <button onClick={interruptRun} disabled={!runId}>
              Interrupt
            </button>
            <button onClick={resumeRun} disabled={!runId}>
              Resume
            </button>
          </div>
          <label>
            Resume Payload（JSON 或文本）
            <textarea value={resumePayloadText} onChange={(e) => setResumePayloadText(e.target.value)} rows={3} />
          </label>

          <h3>Run 摘要</h3>
          <pre>{pretty(runSummary)}</pre>

          <h3>Checkpoint 历史 / Fork</h3>
          <div className="history-list">
            {historyRows.map((row, idx) => {
              const checkpointId = String((row as any)?.checkpointId ?? "");
              return (
                <button
                  key={`${checkpointId}_${idx}`}
                  className={selectedCheckpointId === checkpointId ? "history-item active" : "history-item"}
                  onClick={() => setSelectedCheckpointId(checkpointId)}
                >
                  <span>{checkpointId || "(无 checkpointId)"}</span>
                  <small>{String((row as any)?.runStateSummary?.currentNodeId ?? "")}</small>
                </button>
              );
            })}
          </div>
          <label>
            Fork Reason
            <input value={forkReason} onChange={(e) => setForkReason(e.target.value)} />
          </label>
          <button onClick={forkFromCheckpoint} disabled={!selectedCheckpointId || !threadId}>
            从选中 Checkpoint 分叉
          </button>
        </section>

        <section className="panel center">
          <h2>Trace 时间线（实时 + 补发）</h2>
          <div className="trace-toolbar">
            <span>事件总数: {sortedTraceEvents.length}</span>
            <button onClick={() => setTraceEvents([])}>清空前端 Trace</button>
            <button onClick={() => runId && syncRunSnapshotAndTraceByHttp(runId)} disabled={!runId}>
              HTTP 补拉
            </button>
          </div>

          <div className="trace-metrics">
            {traceCountByType.map(([type, count]) => (
              <span key={type} className="metric-chip">
                {type}: {count}
              </span>
            ))}
          </div>

          <div className="trace-list">
            {sortedTraceEvents.map((evt) => (
              <div key={`${evt.runId}_${evt.seq}`} className={`trace-item trace-${evt.type}`}>
                <div className="trace-head">
                  <strong>#{evt.seq}</strong>
                  <span>{evt.type}</span>
                  <span>{evt.nodeId ?? "-"}</span>
                  <span>{new Date(evt.timestamp).toLocaleTimeString()}</span>
                  {evt.type === "prompt_compiled" ? (
                    <button className="mini" onClick={() => void loadPromptCompileByEvent(evt)}>
                      载入 Prompt 装配
                    </button>
                  ) : null}
                </div>
                <div className="trace-summary">{evt.summary}</div>
                {evt.payload ? <pre>{pretty(evt.payload)}</pre> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="panel right">
          <h2>调试细节</h2>
          <div className="stack">
            <div>
              <h3>State Diffs</h3>
              <pre>{pretty(stateDiffRows)}</pre>
            </div>
            <div>
              <h3>Side Effects</h3>
              <pre>{pretty(sideEffectRows)}</pre>
            </div>
            <div>
              <h3>Run Plan (update_plan)</h3>
              <pre>{pretty(runPlan)}</pre>
            </div>
          </div>
        </section>
      </div>

      <div className="wb-grid lower">
        <section className="panel left">
          <h2>PromptUnit 装配面板（调试草稿）</h2>
          <p className="muted">
            当前会优先读取 `/api/trace/:runId/prompt/:compileId` 中的 `promptAssemblyPlan`；若后端尚未输出，则回退展示 `finalMessages` 草稿。
          </p>
          <div className="prompt-unit-list">
            {promptUnitsDraft.length === 0 ? (
              <div className="empty">暂无 Prompt 装配数据（先在上方 Trace 中点击某条 `prompt_compiled` 的“载入 Prompt 装配”）</div>
            ) : (
              promptUnitsDraft.map((unit, idx) => (
                <div key={unit.id} className="prompt-unit-card">
                  <div className="row compact">
                    <label>
                      <input
                        type="checkbox"
                        checked={unit.enabled}
                        onChange={(e) =>
                          setPromptUnitsDraft((prev) =>
                            prev.map((u, i) => (i === idx ? { ...u, enabled: e.target.checked } : u))
                          )
                        }
                      />
                      启用
                    </label>
                    <input
                      value={unit.role}
                      onChange={(e) =>
                        setPromptUnitsDraft((prev) => prev.map((u, i) => (i === idx ? { ...u, role: e.target.value } : u)))
                      }
                    />
                    <input
                      value={String(unit.sortWeight)}
                      onChange={(e) =>
                        setPromptUnitsDraft((prev) =>
                          prev.map((u, i) => (i === idx ? { ...u, sortWeight: Number(e.target.value || 0) } : u))
                        )
                      }
                    />
                  </div>
                  <label>
                    Placement（文本预览）
                    <input
                      value={unit.placement}
                      onChange={(e) =>
                        setPromptUnitsDraft((prev) =>
                          prev.map((u, i) => (i === idx ? { ...u, placement: e.target.value } : u))
                        )
                      }
                    />
                  </label>
                  <label>
                    Content
                    <textarea
                      rows={4}
                      value={unit.content}
                      onChange={(e) =>
                        setPromptUnitsDraft((prev) =>
                          prev.map((u, i) => (i === idx ? { ...u, content: e.target.value } : u))
                        )
                      }
                    />
                  </label>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel center">
          <h2>内置工具面板（Builtin Tools）</h2>
          <div className="tool-table">
            <div className="tool-table-head">
              <span>工具</span>
              <span>启用</span>
              <span>暴露策略</span>
              <span>权限</span>
            </div>
            {builtinTools.map((tool) => (
              <div key={tool.name} className="tool-table-row">
                <div>
                  <strong>{tool.name}</strong>
                  <small>{tool.description}</small>
                </div>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(tool.runtimeConfig?.enabled)}
                    onChange={(e) => void toggleBuiltinTool(tool.name, e.target.checked)}
                  />
                  <span>{tool.runtimeConfig?.enabled ? "ON" : "OFF"}</span>
                </label>
                <select
                  value={tool.runtimeConfig?.exposurePolicy?.preferredAdapter ?? ""}
                  onChange={(e) => void changeBuiltinExposure(tool.name, e.target.value)}
                >
                  {["responses_native", "chat_function", "chat_custom", "structured_output_tool_call", "prompt_protocol_fallback"].map(
                    (adapter) => (
                      <option key={adapter} value={adapter}>
                        {adapter}
                      </option>
                    )
                  )}
                </select>
                <div className="tiny-stack">
                  <span>{tool.runtimeConfig?.permissionPolicy?.permissionProfileId}</span>
                  <span>{tool.runtimeConfig?.permissionPolicy?.shellPermissionLevel ?? "-"}</span>
                </div>
              </div>
            ))}
          </div>
          <h3>Tool Exposure Policies（枚举）</h3>
          <pre>{pretty(toolExposurePolicies)}</pre>
        </section>

        <section className="panel right">
          <h2>apply_patch Dry-Run</h2>
          <p className="muted">用于测试 Codex 风格 patch DSL（不落盘）。</p>
          <textarea
            className="mono-input"
            value={patchDryRunText}
            onChange={(e) => setPatchDryRunText(e.target.value)}
            rows={12}
          />
          <div className="button-row">
            <button onClick={runApplyPatchDryRun}>执行 Dry-Run</button>
          </div>
          <pre>{pretty(patchDryRunResult)}</pre>
        </section>
      </div>

      <section className="panel ws-panel">
        <h2>WS 状态与重连日志</h2>
        <div className="button-row">
          <button onClick={() => connectWs()}>重新连接 WS</button>
          <button
            onClick={() => {
              wsRef.current?.close();
              appendWsLog("手动关闭 WS");
            }}
          >
            关闭 WS
          </button>
          <button onClick={() => setWsLogs([])}>清空日志</button>
        </div>
        <pre className="ws-log-box">{wsLogs.join("\n")}</pre>
      </section>
    </div>
  );
}

export default App;
