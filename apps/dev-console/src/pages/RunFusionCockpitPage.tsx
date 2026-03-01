/**
 * 本文件作用：
 * - Run Fusion Cockpit 融合运行舱：
 *   1) 左侧：会话/对话流；
 *   2) 右上：节点执行时间线（可点选）；
 *   3) 右中：当前节点详情（Agent/Tool/Memory/Trigger）；
 *   4) 底部：WS/trace/warning/error 实时日志抽屉。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../lib/apiClient";
import { RuntimeWsClient, type WsStatus } from "../lib/wsClient";
import { mergeTraceEvents, pretty } from "../lib/utils";
import type {
  NodeExecutionSnapshotDTO,
  RunSnapshotDTO,
  ToolExposurePlanRow,
  TraceEventDTO,
  UserInputRequestRow
} from "../types";

export function RunFusionCockpitPage() {
  const [workflowId, setWorkflowId] = useState<string>("workflow.mededu.default");
  const [userInput, setUserInput] = useState<string>("请作为医生开始问诊，并给出下一步检查建议。");
  const [providerVendor, setProviderVendor] = useState<string>("mock");
  const [providerApiMode, setProviderApiMode] = useState<"responses" | "chat_completions">("responses");
  const [providerModel, setProviderModel] = useState<string>("gpt-5-mini");
  const [toolProfile, setToolProfile] = useState<string>("auto");

  const [runId, setRunId] = useState<string>("");
  const [threadId, setThreadId] = useState<string>("");
  const [summary, setSummary] = useState<RunSnapshotDTO | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEventDTO[]>([]);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [message, setMessage] = useState<string>("");

  const [toolPlans, setToolPlans] = useState<ToolExposurePlanRow[]>([]);
  const [userInputRequests, setUserInputRequests] = useState<UserInputRequestRow[]>([]);

  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  const wsRef = useRef<RuntimeWsClient | null>(null);

  function appendLog(line: string): void {
    setWsLogs((prev) => [...prev, line].slice(-240));
  }

  async function refreshRun(runIdInput = runId): Promise<void> {
    if (!runIdInput) return;
    const [runResp, traceResp, plansResp, userInputResp] = await Promise.all([
      apiClient.get<RunSnapshotDTO>(`/api/runs/${runIdInput}`),
      apiClient.get<TraceEventDTO[]>(`/api/trace/${runIdInput}/events?afterSeq=0&limit=1000`),
      apiClient.get<ToolExposurePlanRow[]>(`/api/runs/${runIdInput}/tool-exposure-plans?limit=200`),
      apiClient.get<UserInputRequestRow[]>(`/api/runs/${runIdInput}/user-input-requests`)
    ]);
    if (runResp.ok && runResp.data) setSummary(runResp.data);
    if (traceResp.ok && Array.isArray(traceResp.data)) setTraceEvents(traceResp.data);
    if (plansResp.ok && Array.isArray(plansResp.data)) setToolPlans(plansResp.data);
    if (userInputResp.ok && Array.isArray(userInputResp.data)) setUserInputRequests(userInputResp.data);
  }

  useEffect(() => {
    const ws = new RuntimeWsClient({
      onStatus: (status) => setWsStatus(status),
      onLog: (line) => appendLog(line),
      onTraceEvent: (event) => {
        setTraceEvents((prev) => mergeTraceEvents(prev, [event]));
      },
      onReplayEvents: (events) => {
        setTraceEvents((prev) => mergeTraceEvents(prev, events));
      },
      onWarning: (code, line) => appendLog(`[warning] ${code} ${line}`),
      onError: (code, line) => appendLog(`[error] ${code} ${line}`)
    });
    ws.connect();
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (!runId.trim()) return;
    wsRef.current?.subscribeRun(runId);
  }, [runId]);

  async function createRun(): Promise<void> {
    const resp = await apiClient.post<{ runId: string; threadId: string; status: string }>("/api/runs", {
      workflowId,
      userInput,
      provider: {
        vendor: providerVendor,
        apiMode: providerApiMode,
        model: providerModel,
        toolProtocolProfile: toolProfile
      }
    });
    if (!resp.ok || !resp.data) {
      setMessage(`创建 run 失败：${resp.message ?? "未知错误"}`);
      return;
    }
    setRunId(resp.data.runId);
    setThreadId(resp.data.threadId);
    setSelectedSeq(null);
    setMessage(`已创建 run=${resp.data.runId}`);
    await refreshRun(resp.data.runId);
  }

  async function pauseRun(): Promise<void> {
    if (!runId) return;
    await apiClient.post(`/api/runs/${runId}/pause`, { reason: "fusion_pause" });
    await refreshRun();
  }

  async function interruptRun(): Promise<void> {
    if (!runId) return;
    await apiClient.post(`/api/runs/${runId}/interrupt`, { reason: "fusion_interrupt" });
    await refreshRun();
  }

  async function resumeRun(): Promise<void> {
    if (!runId) return;
    await apiClient.post(`/api/runs/${runId}/resume`, { resumePayload: { source: "run-fusion" } });
    await refreshRun();
  }

  const selectedEvent = useMemo(
    () => traceEvents.find((event) => event.seq === selectedSeq) ?? null,
    [selectedSeq, traceEvents]
  );

  const nodeDetail: NodeExecutionSnapshotDTO | null = selectedEvent
    ? {
        nodeId: selectedEvent.nodeId,
        agentId: selectedEvent.agentId,
        type: selectedEvent.type,
        summary: selectedEvent.summary,
        timestamp: selectedEvent.timestamp,
        seq: selectedEvent.seq,
        payload: selectedEvent.payload
      }
    : null;

  const relatedPlans = useMemo(() => {
    if (!selectedEvent) return [];
    return toolPlans.filter((plan) => {
      if (selectedEvent.nodeId && plan.nodeId && selectedEvent.nodeId === plan.nodeId) return true;
      if (selectedEvent.agentId && plan.agentId && selectedEvent.agentId === plan.agentId) return true;
      return false;
    });
  }, [selectedEvent, toolPlans]);

  const conversationRows = useMemo(() => {
    return traceEvents.filter((item) => {
      const lowerType = item.type.toLowerCase();
      return lowerType.includes("message") || lowerType.includes("model") || lowerType.includes("assistant");
    });
  }, [traceEvents]);

  return (
    <section className="page">
      <header className="page-header">
        <h2>Run Fusion Cockpit</h2>
        <p>融合页：左对话 + 右时间线/详情 + 底部日志。覆盖 run 创建、中断恢复、WS 实时追踪。</p>
      </header>

      <article className="panel">
        <div className="form-grid">
          <label>
            Workflow ID
            <input value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} />
          </label>
          <label>
            Vendor
            <input value={providerVendor} onChange={(e) => setProviderVendor(e.target.value)} />
          </label>
          <label>
            API Mode
            <select value={providerApiMode} onChange={(e) => setProviderApiMode(e.target.value as "responses" | "chat_completions")}>
              <option value="responses">responses</option>
              <option value="chat_completions">chat_completions</option>
            </select>
          </label>
          <label>
            Model
            <input value={providerModel} onChange={(e) => setProviderModel(e.target.value)} />
          </label>
          <label>
            Tool Profile
            <input value={toolProfile} onChange={(e) => setToolProfile(e.target.value)} />
          </label>
        </div>
        <label>
          User Input
          <textarea rows={3} value={userInput} onChange={(e) => setUserInput(e.target.value)} />
        </label>
        <div className="row-buttons">
          <button onClick={() => void createRun()}>创建 Run</button>
          <button onClick={() => void refreshRun()} disabled={!runId}>
            刷新
          </button>
          <button onClick={() => void pauseRun()} disabled={!runId}>
            Pause
          </button>
          <button onClick={() => void resumeRun()} disabled={!runId}>
            Resume
          </button>
          <button onClick={() => void interruptRun()} disabled={!runId}>
            Interrupt
          </button>
        </div>
        <p className="hint">
          WS: {wsStatus} | run: {runId || "-"} | thread: {threadId || "-"} | currentNode: {summary?.current_node_id ?? "-"}
        </p>
        {message ? <p className="hint">{message}</p> : null}
      </article>

      <div className="fusion-layout">
        <article className="panel fusion-chat">
          <h3>会话对话区</h3>
          <div className="chat-list">
            {conversationRows.length === 0 ? <p className="hint">暂无会话事件。</p> : null}
            {conversationRows.map((item) => (
              <div key={`${item.runId}_${item.seq}`} className="chat-item">
                <div className="chat-head">
                  <strong>#{item.seq}</strong>
                  <span>{item.type}</span>
                  <span>{item.agentId ?? "-"}</span>
                </div>
                <div className="chat-content">{item.summary}</div>
              </div>
            ))}
          </div>
        </article>

        <section className="fusion-right">
          <article className="panel">
            <h3>节点执行时间线 + 分支快照</h3>
            <div className="timeline-list">
              {traceEvents.map((item) => (
                <button
                  key={`${item.runId}_${item.seq}`}
                  className={selectedSeq === item.seq ? "timeline-item active" : "timeline-item"}
                  onClick={() => setSelectedSeq(item.seq)}
                >
                  <span>#{item.seq}</span>
                  <span>{item.nodeId ?? "-"}</span>
                  <span>{item.type}</span>
                </button>
              ))}
            </div>
          </article>

          <article className="panel">
            <h3>当前节点详情（Agent / Tool / Memory / Trigger）</h3>
            <pre>{pretty(nodeDetail)}</pre>
            <h4>关联工具暴露计划</h4>
            <pre>{pretty(relatedPlans)}</pre>
            <h4>关联用户输入请求</h4>
            <pre>{pretty(userInputRequests)}</pre>
          </article>
        </section>
      </div>

      <article className="panel log-drawer">
        <h3>实时日志抽屉（WS / warning / error / trace）</h3>
        <div className="row-buttons">
          <button onClick={() => setWsLogs([])}>清空日志</button>
          <button onClick={() => wsRef.current?.connect()}>重连 WS</button>
          <button onClick={() => wsRef.current?.requestReplay(runId, selectedEvent?.seq ?? 0, 200)} disabled={!runId}>
            请求补发
          </button>
        </div>
        <pre className="log-box">{wsLogs.join("\n")}</pre>
        <h4>最新 Run 摘要</h4>
        <pre>{pretty(summary)}</pre>
      </article>
    </section>
  );
}
