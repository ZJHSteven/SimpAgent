/**
 * 文件作用：
 * - 作为 dev-console 的主界面，把 runtime-node 的 HTTP / WS 能力组织成结构化调试工作台。
 * - 主视图优先展示 agent / prompt unit / tool / workflow / trace / checkpoint 等可读信息；
 * - 原始 JSON 仍然保留，但退到折叠区，用作排错兜底。
 */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import "./App.css";
import { deriveWsUrl, requestJson, toErrorMessage, withJsonBody } from "./api";
import type {
  AgentSummary,
  ApprovalRequestSummary,
  BuiltinToolSummary,
  CatalogNodeSummary,
  CatalogRelationSummary,
  CheckpointHistoryItem,
  PromptCompileDetail,
  PromptUnitSummary,
  ProviderFormState,
  RunSummary,
  RuntimeHealth,
  RuntimeTemplateSummary,
  SideEffectSummary,
  StateDiffSummary,
  SystemConfigView,
  ToolExposurePlanSummary,
  ToolExposurePolicyMeta,
  TraceEventSummary,
  WorkflowSummary,
  WsServerEvent
} from "./types";

const DEFAULT_HTTP_BASE_URL =
  (import.meta.env.VITE_RUNTIME_NODE_BASE_URL as string | undefined)?.trim() || "http://localhost:3002";

const STORAGE_KEYS = {
  runtimeBaseUrl: "simpagent.devConsole.runtimeBaseUrl",
  wsUrl: "simpagent.devConsole.wsUrl",
  provider: "simpagent.devConsole.provider",
  runInput: "simpagent.devConsole.runInput"
} as const;

const DEFAULT_PROVIDER_FORM: ProviderFormState = {
  vendor: "generic_openai_compat",
  apiMode: "chat_completions",
  baseURL: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  temperature: "0.2"
};

const PREFERRED_WORKFLOW_IDS = [
  "workflow.devconsole.medical_training_bench",
  "workflow.default"
] as const;

function readStoredString(key: string, fallback: string): string {
  const value = window.localStorage.getItem(key);
  return value && value.trim() ? value : fallback;
}

function readStoredProviderForm(): ProviderFormState {
  const raw = window.localStorage.getItem(STORAGE_KEYS.provider);
  if (!raw) return DEFAULT_PROVIDER_FORM;
  try {
    return { ...DEFAULT_PROVIDER_FORM, ...(JSON.parse(raw) as Partial<ProviderFormState>) };
  } catch {
    return DEFAULT_PROVIDER_FORM;
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function parseJsonInput(text: string): Record<string, unknown> | Array<unknown> {
  return JSON.parse(text) as Record<string, unknown> | Array<unknown>;
}

function extractCompileId(event: TraceEventSummary): string | null {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return null;
  const compileId = (event.payload as Record<string, unknown>).compileId;
  return typeof compileId === "string" ? compileId : null;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function truncateText(value: string | undefined, max = 140): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function countBy<T extends string>(values: T[]): Array<{ key: T; count: number }> {
  const map = new Map<T, number>();
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function Card(props: { title: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle ? <p>{props.subtitle}</p> : null}
        </div>
        {props.actions ? <div className="card__actions">{props.actions}</div> : null}
      </header>
      <div className="card__body">{props.children}</div>
    </section>
  );
}

function JsonPanel(props: { value: unknown; emptyText: string }) {
  return <pre className="json-panel">{props.value === undefined || props.value === null ? props.emptyText : formatJson(props.value)}</pre>;
}

function RawJsonDetails(props: { summary: string; value: unknown; emptyText: string }) {
  return (
    <details className="raw-details">
      <summary>{props.summary}</summary>
      <JsonPanel value={props.value} emptyText={props.emptyText} />
    </details>
  );
}

function MetricCard(props: { label: string; value: string | number; hint?: string }) {
  return (
    <article className="metric-card">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
      {props.hint ? <small>{props.hint}</small> : null}
    </article>
  );
}

function BadgeList(props: { values: string[]; emptyText?: string; tone?: "default" | "good" | "warn" }) {
  if (!props.values.length) return <div className="empty-inline">{props.emptyText ?? "暂无"}</div>;
  return (
    <div className="badge-list">
      {props.values.map((value) => (
        <span key={value} className={`badge badge--${props.tone ?? "default"}`}>
          {value}
        </span>
      ))}
    </div>
  );
}

function EmptyHint(props: { text: string }) {
  return <div className="empty-hint">{props.text}</div>;
}

function WorkflowGraph(props: { workflow: WorkflowSummary | null }) {
  if (!props.workflow) return <EmptyHint text="当前没有 workflow。" />;
  return (
    <div className="workflow-board">
      <div className="workflow-graph">
        {props.workflow.nodes.map((node) => (
          <article key={node.id} className="node-card">
            <strong>{node.label || node.id}</strong>
            <span>{node.type}</span>
            <p>{node.agentId ?? node.toolId ?? "未绑定实体"}</p>
          </article>
        ))}
      </div>
      <div className="edge-list">
        {props.workflow.edges.length ? (
          props.workflow.edges.map((edge, index) => (
            <article key={edge.id || `${edge.from}-${edge.to}-${index}`} className="edge-card">
              <strong>{edge.from}</strong>
              <span className="edge-card__arrow">→</span>
              <strong>{edge.to}</strong>
              <p>
                优先级：{edge.priority ?? "未声明"}
                {edge.condition ? ` / 条件：${truncateText(formatJson(edge.condition), 80)}` : ""}
              </p>
            </article>
          ))
        ) : (
          <EmptyHint text="当前 workflow 没有 edges。" />
        )}
      </div>
    </div>
  );
}

function App() {
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState(() => readStoredString(STORAGE_KEYS.runtimeBaseUrl, DEFAULT_HTTP_BASE_URL));
  const [wsUrl, setWsUrl] = useState(() => readStoredString(STORAGE_KEYS.wsUrl, deriveWsUrl(DEFAULT_HTTP_BASE_URL)));
  const [providerForm, setProviderForm] = useState<ProviderFormState>(() => readStoredProviderForm());
  const [runInput, setRunInput] = useState(() => readStoredString(STORAGE_KEYS.runInput, "请基于当前 workflow 开始执行，并尽量给出结构化、可审计的输出。"));
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedPromptUnitId, setSelectedPromptUnitId] = useState("");
  const [statusText, setStatusText] = useState("尚未加载框架资源。");
  const [errorText, setErrorText] = useState("");
  const [busyText, setBusyText] = useState("");

  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [promptUnits, setPromptUnits] = useState<PromptUnitSummary[]>([]);
  const [builtinTools, setBuiltinTools] = useState<BuiltinToolSummary[]>([]);
  const [catalogNodes, setCatalogNodes] = useState<CatalogNodeSummary[]>([]);
  const [catalogRelations, setCatalogRelations] = useState<CatalogRelationSummary[]>([]);
  const [templates, setTemplates] = useState<RuntimeTemplateSummary[]>([]);
  const [systemConfig, setSystemConfig] = useState<SystemConfigView | null>(null);
  const [toolExposureMeta, setToolExposureMeta] = useState<ToolExposurePolicyMeta | null>(null);

  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [activeRunId, setActiveRunId] = useState("");
  const [activeThreadId, setActiveThreadId] = useState("");
  const [traces, setTraces] = useState<TraceEventSummary[]>([]);
  const [stateDiffs, setStateDiffs] = useState<StateDiffSummary[]>([]);
  const [sideEffects, setSideEffects] = useState<SideEffectSummary[]>([]);
  const [toolExposurePlans, setToolExposurePlans] = useState<ToolExposurePlanSummary[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequestSummary[]>([]);
  const [historyItems, setHistoryItems] = useState<CheckpointHistoryItem[]>([]);
  const [selectedCompileId, setSelectedCompileId] = useState("");
  const [promptCompile, setPromptCompile] = useState<PromptCompileDetail | null>(null);
  const [wsState, setWsState] = useState("idle");
  const [statePatchText, setStatePatchText] = useState('{\n  "conversationState": {\n    "latestAssistantText": "这是人工修订后的阶段性结果。"\n  }\n}');
  const [promptUnitOverrideText, setPromptUnitOverrideText] = useState('[\n  {\n    "overrideId": "override.sample.sort",\n    "unitId": "block.devconsole.med.system",\n    "action": "change_sort",\n    "payload": {\n      "priority": 999\n    }\n  }\n]');
  const lastEventSeqRef = useRef(0);

  const selectedWorkflow = useMemo(() => workflows.find((item) => item.id === selectedWorkflowId) ?? null, [selectedWorkflowId, workflows]);
  const selectedAgent = useMemo(() => agents.find((item) => item.id === selectedAgentId) ?? null, [agents, selectedAgentId]);
  const selectedPromptUnit = useMemo(() => promptUnits.find((item) => item.id === selectedPromptUnitId) ?? null, [promptUnits, selectedPromptUnitId]);
  const promptUnitMap = useMemo(() => new Map(promptUnits.map((unit) => [unit.id, unit])), [promptUnits]);
  const recentTraces = useMemo(() => [...traces].sort((left, right) => right.seq - left.seq).slice(0, 24), [traces]);
  const latestCheckpoint = historyItems[0] ?? null;
  const catalogClassSummary = useMemo(() => countBy(catalogNodes.map((item) => item.nodeClass)), [catalogNodes]);
  const relationTypeSummary = useMemo(() => countBy(catalogRelations.map((item) => item.relationType)), [catalogRelations]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.runtimeBaseUrl, runtimeBaseUrl);
    window.localStorage.setItem(STORAGE_KEYS.wsUrl, wsUrl);
    window.localStorage.setItem(STORAGE_KEYS.provider, JSON.stringify(providerForm));
    window.localStorage.setItem(STORAGE_KEYS.runInput, runInput);
  }, [runtimeBaseUrl, wsUrl, providerForm, runInput]);

  useEffect(() => {
    if (!selectedAgentId || !agents.some((item) => item.id === selectedAgentId)) {
      const preferredAgent =
        agents.find((item) => item.id === "agent.devconsole.orchestrator") ??
        agents.find((item) => item.role === "orchestrator") ??
        agents[0] ??
        null;
      if (preferredAgent) setSelectedAgentId(preferredAgent.id);
    }
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (!selectedPromptUnitId || !promptUnits.some((item) => item.id === selectedPromptUnitId)) {
      const preferredPromptUnit =
        promptUnits.find((item) => item.id === "block.devconsole.med.system") ??
        promptUnits.find((item) => item.id === "block.system.safety") ??
        promptUnits[0] ??
        null;
      if (preferredPromptUnit) setSelectedPromptUnitId(preferredPromptUnit.id);
    }
  }, [promptUnits, selectedPromptUnitId]);

  async function loadInventory() {
    try {
      const [
        nextHealth,
        nextAgents,
        nextWorkflows,
        nextPromptUnits,
        nextBuiltinTools,
        nextCatalogNodes,
        nextCatalogRelations,
        nextTemplates,
        nextSystemConfig,
        nextExposureMeta
      ] = await Promise.all([
        requestJson<RuntimeHealth>(runtimeBaseUrl, "/api/health"),
        requestJson<AgentSummary[]>(runtimeBaseUrl, "/api/agents"),
        requestJson<WorkflowSummary[]>(runtimeBaseUrl, "/api/workflows"),
        requestJson<PromptUnitSummary[]>(runtimeBaseUrl, "/api/prompt-units"),
        requestJson<BuiltinToolSummary[]>(runtimeBaseUrl, "/api/tools/builtin"),
        requestJson<CatalogNodeSummary[]>(runtimeBaseUrl, "/api/catalog/nodes"),
        requestJson<CatalogRelationSummary[]>(runtimeBaseUrl, "/api/catalog/relations"),
        requestJson<RuntimeTemplateSummary[]>(runtimeBaseUrl, "/api/templates"),
        requestJson<SystemConfigView>(runtimeBaseUrl, "/api/config/system"),
        requestJson<ToolExposurePolicyMeta>(runtimeBaseUrl, "/api/config/tool-exposure-policies")
      ]);
      setHealth(nextHealth);
      setAgents(nextAgents);
      setWorkflows(nextWorkflows);
      setPromptUnits(nextPromptUnits);
      setBuiltinTools(nextBuiltinTools);
      setCatalogNodes(nextCatalogNodes);
      setCatalogRelations(nextCatalogRelations);
      setTemplates(nextTemplates);
      setSystemConfig(nextSystemConfig);
      setToolExposureMeta(nextExposureMeta);
      if (!selectedWorkflowId && nextWorkflows[0]) {
        const preferredWorkflow =
          PREFERRED_WORKFLOW_IDS.map((id) => nextWorkflows.find((workflow) => workflow.id === id)).find(Boolean) ??
          nextWorkflows[0];
        setSelectedWorkflowId(preferredWorkflow.id);
      }
      if (!selectedTemplateId && nextTemplates[0]) setSelectedTemplateId(nextTemplates[0].id);
      setStatusText(`已加载框架库存：${nextAgents.length} 个 agent / ${nextWorkflows.length} 个 workflow / ${nextCatalogNodes.length} 个 catalog 节点`);
      setErrorText("");
    } catch (error) {
      setErrorText(toErrorMessage(error));
    }
  }

  async function loadRunViews(runId = activeRunId, threadId = activeThreadId) {
    if (!runId) return;
    try {
      const summary = await requestJson<RunSummary>(runtimeBaseUrl, `/api/runs/${runId}`);
      setRunSummary(summary);
      setActiveRunId(summary.run_id);
      setActiveThreadId(summary.thread_id);
      const [nextTraces, nextStateDiffs, nextSideEffects, nextToolExposurePlans, nextApprovals] = await Promise.all([
        requestJson<TraceEventSummary[]>(runtimeBaseUrl, `/api/trace/${runId}/events?afterSeq=0&limit=200`),
        requestJson<StateDiffSummary[]>(runtimeBaseUrl, `/api/runs/${runId}/state-diffs?limit=30`),
        requestJson<SideEffectSummary[]>(runtimeBaseUrl, `/api/runs/${runId}/side-effects?limit=30`),
        requestJson<ToolExposurePlanSummary[]>(runtimeBaseUrl, `/api/runs/${runId}/tool-exposure-plans?limit=20`),
        requestJson<ApprovalRequestSummary[]>(runtimeBaseUrl, `/api/runs/${runId}/approval-requests`)
      ]);
      setTraces(nextTraces);
      setStateDiffs(nextStateDiffs);
      setSideEffects(nextSideEffects);
      setToolExposurePlans(nextToolExposurePlans);
      setApprovals(nextApprovals);
      if (summary.thread_id || threadId) {
        setHistoryItems(await requestJson<CheckpointHistoryItem[]>(runtimeBaseUrl, `/api/threads/${summary.thread_id || threadId}/history`));
      }
      const latestCompileId = [...nextTraces].reverse().map(extractCompileId).find(Boolean) ?? "";
      if (latestCompileId) setSelectedCompileId(latestCompileId);
      setErrorText("");
    } catch (error) {
      setErrorText(toErrorMessage(error));
    }
  }

  async function runBusyAction(label: string, action: () => Promise<void>) {
    setBusyText(label);
    setErrorText("");
    try {
      await action();
    } catch (error) {
      setErrorText(toErrorMessage(error));
    } finally {
      setBusyText("");
    }
  }

  async function createRun() {
    if (!selectedWorkflowId) return setErrorText("请先选择 workflow。");
    if (!providerForm.model.trim()) return setErrorText("请填写模型名（model）。");
    await runBusyAction("正在创建真实 Run...", async () => {
      const created = await requestJson<{ runId: string; threadId: string }>(runtimeBaseUrl, "/api/runs", withJsonBody({
        workflowId: selectedWorkflowId,
        userInput: runInput,
        provider: {
          vendor: providerForm.vendor,
          apiMode: providerForm.apiMode,
          model: providerForm.model,
          baseURL: providerForm.baseURL.trim() || undefined,
          apiKey: providerForm.apiKey.trim() || undefined,
          temperature: providerForm.temperature.trim() ? Number(providerForm.temperature) : undefined
        }
      }));
      setActiveRunId(created.runId);
      setActiveThreadId(created.threadId);
      setTraces([]);
      setStateDiffs([]);
      setSideEffects([]);
      setToolExposurePlans([]);
      setApprovals([]);
      setHistoryItems([]);
      setSelectedCompileId("");
      lastEventSeqRef.current = 0;
      setStatusText(`已创建真实 run：${created.runId}`);
      await loadRunViews(created.runId, created.threadId);
    });
  }

  async function postAction(path: string, body: Record<string, unknown>) {
    await runBusyAction("正在执行操作...", async () => {
      await requestJson<Record<string, unknown>>(runtimeBaseUrl, path, withJsonBody(body));
      await loadRunViews(activeRunId, activeThreadId);
    });
  }

  async function saveAgent(agent: AgentSummary, successText: string) {
    await runBusyAction("正在保存 Agent 配置...", async () => {
      await requestJson<AgentSummary>(runtimeBaseUrl, `/api/agents/${agent.id}`, withJsonBody(agent, "PUT"));
      await loadInventory();
      setStatusText(successText);
    });
  }

  async function movePromptBinding(agent: AgentSummary, bindingId: string, direction: -1 | 1) {
    const bindings = [...(agent.promptBindings ?? [])].sort((left, right) => left.order - right.order);
    const currentIndex = bindings.findIndex((item) => item.bindingId === bindingId);
    if (currentIndex < 0) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= bindings.length) return;
    const nextBindings = [...bindings];
    const [current] = nextBindings.splice(currentIndex, 1);
    nextBindings.splice(targetIndex, 0, current);
    await saveAgent(
      {
        ...agent,
        promptBindings: nextBindings.map((item, index) => ({ ...item, order: (index + 1) * 10 }))
      },
      `已更新 ${agent.name} 的 PromptUnit 顺序`
    );
  }

  async function togglePromptBinding(agent: AgentSummary, bindingId: string) {
    await saveAgent(
      {
        ...agent,
        promptBindings: (agent.promptBindings ?? []).map((item) =>
          item.bindingId === bindingId ? { ...item, enabled: !item.enabled } : item
        )
      },
      `已更新 ${agent.name} 的 PromptUnit 开关`
    );
  }

  async function toggleBuiltinTool(tool: BuiltinToolSummary) {
    await runBusyAction("正在保存工具配置...", async () => {
      await requestJson<BuiltinToolSummary>(
        runtimeBaseUrl,
        `/api/tools/builtin/${tool.name}`,
        withJsonBody({ enabled: !tool.runtimeConfig.enabled }, "PUT")
      );
      await loadInventory();
      setStatusText(`已更新工具 ${tool.name} 的启用状态`);
    });
  }

  async function respondApproval(requestId: string, approved: boolean) {
    await postAction(`/api/runs/${activeRunId}/approval-requests/${requestId}/respond`, {
      requestId,
      approved,
      action: approved ? "approve" : "reject",
      justification: approved ? "dev-console approve" : "dev-console reject"
    });
  }

  const handleWsMessage = useEffectEvent((message: WsServerEvent) => {
    if (message.type === "trace_event") {
      lastEventSeqRef.current = Math.max(lastEventSeqRef.current, message.event.seq);
      setTraces((prev) => [...prev.filter((item) => item.seq !== message.event.seq), message.event].sort((a, b) => a.seq - b.seq).slice(-200));
      const compileId = extractCompileId(message.event);
      if (compileId) setSelectedCompileId(compileId);
      return;
    }
    if (message.type === "run_snapshot") {
      setActiveThreadId(message.snapshot.threadId);
      setRunSummary((prev) =>
        prev
          ? { ...prev, status: message.snapshot.status, current_node_id: message.snapshot.currentNodeId ?? null }
          : prev
      );
      return;
    }
    if (message.type === "warning" || message.type === "error") {
      setErrorText(`[${message.code}] ${message.message}`);
    }
  });

  useEffect(() => {
    void loadInventory();
  }, []);

  useEffect(() => {
    if (!activeRunId || !selectedCompileId) return;
    void requestJson<PromptCompileDetail>(runtimeBaseUrl, `/api/trace/${activeRunId}/prompt/${selectedCompileId}`)
      .then(setPromptCompile)
      .catch((error) => setErrorText(toErrorMessage(error)));
  }, [activeRunId, selectedCompileId, runtimeBaseUrl]);

  useEffect(() => {
    if (!activeRunId || !wsUrl.trim()) return;
    setWsState("connecting");
    const socket = new WebSocket(wsUrl);
    socket.addEventListener("open", () => {
      setWsState("connected");
      socket.send(JSON.stringify({ type: "hello", lastEventSeq: lastEventSeqRef.current }));
      socket.send(JSON.stringify({ type: "subscribe_run", runId: activeRunId, lastEventSeq: lastEventSeqRef.current }));
    });
    socket.addEventListener("message", (event) => {
      try {
        handleWsMessage(JSON.parse(String(event.data)) as WsServerEvent);
      } catch {
        setErrorText("WS 消息解析失败。");
      }
    });
    socket.addEventListener("close", () => setWsState("closed"));
    socket.addEventListener("error", () => setWsState("error"));
    return () => socket.close();
  }, [activeRunId, handleWsMessage, wsUrl]);

  return (
    <div className="console-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Framework Smoke Bench</p>
          <h1>SimpAgent 框架调试台</h1>
          <p className="hero__summary">
            这个页面不是业务产品前台，而是框架工作台。重点是让人直接看见 prompt 组装、workflow 拓扑、tool 开关、trace、approval、fork 和 checkpoint。
          </p>
        </div>
        <div className="hero__meta">
          <span className="pill">HTTP：{health ? "已连接" : "未连接"}</span>
          <span className="pill">WS：{wsState}</span>
          <span className="pill">Run：{runSummary?.status ?? "未创建"}</span>
          <span className="pill">忙碌状态：{busyText || "空闲"}</span>
        </div>
      </header>

      <section className="status-bar">
        <span>{statusText}</span>
        <div className="status-bar__right">
          {busyText ? <span className="status-pill status-pill--warn">{busyText}</span> : null}
          {errorText ? <strong>{errorText}</strong> : null}
        </div>
      </section>

      <main className="grid">
        <Card title="真实 LLM 与运行入口" subtitle="这里保留 OpenAI-compatible 配置口，默认已经填入 DeepSeek 兼容参数。">
          <div className="form-grid">
            <label><span>HTTP Base URL</span><input value={runtimeBaseUrl} onChange={(event) => setRuntimeBaseUrl(event.target.value)} /></label>
            <label><span>WS URL</span><input value={wsUrl} onChange={(event) => setWsUrl(event.target.value)} /></label>
            <label><span>Vendor</span><input value={providerForm.vendor} onChange={(event) => setProviderForm((prev) => ({ ...prev, vendor: event.target.value }))} /></label>
            <label><span>API Mode</span><select value={providerForm.apiMode} onChange={(event) => setProviderForm((prev) => ({ ...prev, apiMode: event.target.value as ProviderFormState["apiMode"] }))}><option value="chat_completions">chat_completions</option><option value="responses">responses</option></select></label>
            <label><span>Model</span><input value={providerForm.model} onChange={(event) => setProviderForm((prev) => ({ ...prev, model: event.target.value }))} /></label>
            <label><span>Temperature</span><input value={providerForm.temperature} onChange={(event) => setProviderForm((prev) => ({ ...prev, temperature: event.target.value }))} /></label>
            <label className="wide"><span>Base URL</span><input value={providerForm.baseURL} onChange={(event) => setProviderForm((prev) => ({ ...prev, baseURL: event.target.value }))} /></label>
            <label className="wide"><span>API Key</span><input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm((prev) => ({ ...prev, apiKey: event.target.value }))} /></label>
            <label><span>Workflow</span><select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)}>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label>
            <label><span>模板</span><select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            <label className="wide"><span>用户输入</span><textarea value={runInput} onChange={(event) => setRunInput(event.target.value)} rows={4} /></label>
          </div>
          <div className="button-row">
            <button onClick={() => setWsUrl(deriveWsUrl(runtimeBaseUrl))}>按 HTTP 地址重算 WS</button>
            <button onClick={() => void loadInventory()}>刷新库存</button>
            <button
              onClick={() =>
                void runBusyAction("正在应用模板...", async () => {
                  await requestJson<Record<string, unknown>>(runtimeBaseUrl, `/api/templates/${selectedTemplateId}/apply`, withJsonBody({}));
                  await loadInventory();
                })
              }
              disabled={!selectedTemplateId}
            >
              应用模板
            </button>
            <button className="primary" onClick={() => void createRun()}>创建真实 Run</button>
          </div>
        </Card>

        <Card title="库存总览" subtitle="主视图优先展示 agent / prompt unit / workflow，而不是直接展示整段 JSON。">
          <div className="metric-grid">
            <MetricCard label="Agents" value={agents.length} hint="含默认 seed + app preset" />
            <MetricCard label="Workflows" value={workflows.length} />
            <MetricCard label="PromptUnits" value={promptUnits.length} />
            <MetricCard label="Builtin Tools" value={builtinTools.length} />
            <MetricCard label="Catalog Nodes" value={catalogNodes.length} />
            <MetricCard label="Relations" value={catalogRelations.length} />
          </div>
          <div className="inventory-columns">
            <section className="list-panel">
              <header className="list-panel__header">
                <h3>Agent 列表</h3>
                <span>{agents.length} 个</span>
              </header>
              <div className="selection-list">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    className={`selection-card ${selectedAgentId === agent.id ? "selection-card--active" : ""}`}
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <strong>{agent.name}</strong>
                    <span>{agent.role || "未声明角色"}</span>
                    <small>{agent.id}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="detail-panel">
              <header className="list-panel__header">
                <h3>当前 Agent 详情</h3>
                {selectedAgent ? <span>{selectedAgent.id}</span> : null}
              </header>
              {selectedAgent ? (
                <div className="detail-stack">
                  <article className="info-card">
                    <h4>{selectedAgent.name}</h4>
                    <p>{selectedAgent.description || "暂无说明。"}</p>
                    <div className="kv-grid">
                      <div><span>角色</span><strong>{selectedAgent.role || "未声明"}</strong></div>
                      <div><span>版本</span><strong>{selectedAgent.version}</strong></div>
                      <div><span>启用</span><strong>{selectedAgent.enabled === false ? "否" : "是"}</strong></div>
                      <div><span>工具路由</span><strong>{selectedAgent.toolRoutePolicy?.mode || "未声明"}</strong></div>
                    </div>
                    <div className="info-card__section">
                      <strong>工具白名单</strong>
                      <BadgeList values={selectedAgent.toolAllowList ?? []} emptyText="当前未配置工具白名单" />
                    </div>
                    <div className="info-card__section">
                      <strong>允许 handoff 目标</strong>
                      <BadgeList values={selectedAgent.handoffPolicy?.allowedTargets ?? []} emptyText="当前未配置 handoff 目标" tone="good" />
                    </div>
                    <div className="info-card__section">
                      <strong>标签</strong>
                      <BadgeList values={selectedAgent.tags ?? []} emptyText="当前无 tags" />
                    </div>
                  </article>

                  <article className="info-card">
                    <h4>PromptUnit 绑定</h4>
                    {selectedAgent.promptBindings?.length ? (
                      <div className="binding-list">
                        {[...(selectedAgent.promptBindings ?? [])]
                          .sort((left, right) => left.order - right.order)
                          .map((binding, index, list) => {
                            const unit = promptUnitMap.get(binding.unitId);
                            return (
                              <article key={binding.bindingId} className="binding-card">
                                <div className="binding-card__main">
                                  <strong>{unit?.name || binding.unitId}</strong>
                                  <span>{unit?.kind || "未知 kind"} / {unit?.insertionPoint || "未声明插入点"}</span>
                                  <p>{truncateText(unit?.template, 120) || "暂无模板摘要。"}</p>
                                </div>
                                <div className="binding-card__meta">
                                  <span className={`status-pill ${binding.enabled ? "status-pill--good" : "status-pill--danger"}`}>
                                    {binding.enabled ? "已启用" : "已禁用"}
                                  </span>
                                  <span className="status-pill">顺序 {binding.order}</span>
                                </div>
                                <div className="button-row button-row--tight">
                                  <button onClick={() => setSelectedPromptUnitId(binding.unitId)}>查看 PromptUnit</button>
                                  <button onClick={() => void movePromptBinding(selectedAgent, binding.bindingId, -1)} disabled={index === 0}>上移</button>
                                  <button onClick={() => void movePromptBinding(selectedAgent, binding.bindingId, 1)} disabled={index === list.length - 1}>下移</button>
                                  <button onClick={() => void togglePromptBinding(selectedAgent, binding.bindingId)}>{binding.enabled ? "禁用" : "启用"}</button>
                                </div>
                              </article>
                            );
                          })}
                      </div>
                    ) : (
                      <EmptyHint text="当前 agent 没有 promptBindings。" />
                    )}
                  </article>
                </div>
              ) : (
                <EmptyHint text="请选择一个 agent。" />
              )}
            </section>

            <section className="detail-panel">
              <header className="list-panel__header">
                <h3>PromptUnit 库</h3>
                <span>{promptUnits.length} 个</span>
              </header>
              <div className="selection-list selection-list--compact">
                {promptUnits.map((unit) => (
                  <button
                    key={unit.id}
                    className={`selection-card ${selectedPromptUnitId === unit.id ? "selection-card--active" : ""}`}
                    onClick={() => setSelectedPromptUnitId(unit.id)}
                  >
                    <strong>{unit.name}</strong>
                    <span>{unit.kind} / {unit.insertionPoint || "未声明插入点"}</span>
                    <small>{unit.id}</small>
                  </button>
                ))}
              </div>
              {selectedPromptUnit ? (
                <article className="info-card">
                  <h4>{selectedPromptUnit.name}</h4>
                  <div className="kv-grid">
                    <div><span>kind</span><strong>{selectedPromptUnit.kind}</strong></div>
                    <div><span>priority</span><strong>{selectedPromptUnit.priority ?? "未声明"}</strong></div>
                    <div><span>插入点</span><strong>{selectedPromptUnit.insertionPoint || "未声明"}</strong></div>
                    <div><span>启用</span><strong>{selectedPromptUnit.enabled ? "是" : "否"}</strong></div>
                  </div>
                  <div className="info-card__section">
                    <strong>适用 agent</strong>
                    <BadgeList values={selectedPromptUnit.trigger?.agentIds ?? []} emptyText="未设置 agent trigger，通常代表全局可用" />
                  </div>
                  <div className="info-card__section">
                    <strong>标签</strong>
                    <BadgeList values={selectedPromptUnit.tags ?? []} emptyText="当前无 tags" />
                  </div>
                  <div className="template-preview">{selectedPromptUnit.template}</div>
                </article>
              ) : (
                <EmptyHint text="请选择一个 PromptUnit。" />
              )}
            </section>
          </div>
          <RawJsonDetails summary="查看库存原始 JSON" value={{ agents, promptUnits, builtinTools }} emptyText="暂无库存原始数据。" />
        </Card>

        <Card title="Builtin Tools / Workflow / Catalog" subtitle="把工具状态、workflow 拓扑和统一图谱摘要放在同一屏，方便判断当前框架拓扑是否接通。">
          <div className="triple-grid">
            <section className="detail-panel">
              <header className="list-panel__header">
                <h3>Builtin Tools</h3>
                <span>{builtinTools.length} 个</span>
              </header>
              <div className="tool-list">
                {builtinTools.map((tool) => (
                  <article key={tool.name} className="info-card">
                    <div className="tool-card__header">
                      <div>
                        <h4>{tool.name}</h4>
                        <p>{tool.description}</p>
                      </div>
                      <button onClick={() => void toggleBuiltinTool(tool)}>{tool.runtimeConfig.enabled ? "禁用" : "启用"}</button>
                    </div>
                    <div className="kv-grid">
                      <div><span>当前状态</span><strong>{tool.runtimeConfig.enabled ? "已启用" : "已禁用"}</strong></div>
                      <div><span>preferred adapter</span><strong>{String(tool.runtimeConfig.exposurePolicy?.preferredAdapter ?? "未声明")}</strong></div>
                    </div>
                    <div className="info-card__section">
                      <strong>fallback adapters</strong>
                      <BadgeList values={Array.isArray(tool.runtimeConfig.exposurePolicy?.fallbackAdapters) ? (tool.runtimeConfig.exposurePolicy?.fallbackAdapters as string[]) : []} emptyText="无 fallback adapters" />
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="detail-panel">
              <header className="list-panel__header">
                <h3>Workflow</h3>
                <span>{selectedWorkflow?.name || "未选中"}</span>
              </header>
              <WorkflowGraph workflow={selectedWorkflow} />
            </section>

            <section className="detail-panel">
              <header className="list-panel__header">
                <h3>Catalog 摘要</h3>
                <span>{catalogNodes.length} nodes / {catalogRelations.length} relations</span>
              </header>
              <div className="stack-grid">
                <article className="info-card">
                  <h4>Node Class 分布</h4>
                  {catalogClassSummary.length ? (
                    <div className="summary-list">
                      {catalogClassSummary.map((item) => (
                        <div key={item.key} className="summary-row">
                          <span>{item.key}</span>
                          <strong>{item.count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyHint text="暂无 catalog nodes。" />
                  )}
                </article>
                <article className="info-card">
                  <h4>Relation Type 分布</h4>
                  {relationTypeSummary.length ? (
                    <div className="summary-list">
                      {relationTypeSummary.map((item) => (
                        <div key={item.key} className="summary-row">
                          <span>{item.key}</span>
                          <strong>{item.count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyHint text="暂无 catalog relations。" />
                  )}
                </article>
              </div>
            </section>
          </div>
          <RawJsonDetails summary="查看 workflow / catalog / tool 原始 JSON" value={{ selectedWorkflow, catalogNodes, catalogRelations, toolExposureMeta }} emptyText="暂无 workflow / catalog 原始数据。" />
        </Card>

        <Card title="当前 Run 控制与审批" subtitle="这里验证 human-in-the-loop 主链：创建后可刷新、暂停、恢复、中断、处理审批。">
          {runSummary ? (
            <div className="run-header">
              <span className="pill">{runSummary.run_id}</span>
              <span className="pill">{runSummary.current_node_id ?? "END"}</span>
              <span className="pill">{runSummary.status}</span>
              <span className="pill">{formatDateTime(runSummary.updated_at)}</span>
              <button onClick={() => void loadRunViews()}>刷新 Run</button>
              <button onClick={() => void postAction(`/api/runs/${activeRunId}/pause`, { reason: "dev-console pause" })}>Pause</button>
              <button onClick={() => void postAction(`/api/runs/${activeRunId}/resume`, { resumePayload: { source: "dev-console" } })}>Resume</button>
              <button onClick={() => void postAction(`/api/runs/${activeRunId}/interrupt`, { reason: "dev-console interrupt", payload: { source: "dev-console" } })}>Interrupt</button>
            </div>
          ) : (
            <EmptyHint text="尚未创建 run。" />
          )}
          <div className="double-grid">
            <article className="info-card">
              <h4>审批请求</h4>
              {approvals.length ? (
                <div className="stack-grid">
                  {approvals.map((approval) => (
                    <article key={approval.requestId} className="approval-card">
                      <div className="approval-card__header">
                        <strong>{approval.summary}</strong>
                        <span className={`status-pill ${approval.status === "pending" ? "status-pill--warn" : "status-pill--good"}`}>{approval.status}</span>
                      </div>
                      <p>scope: {approval.scope}</p>
                      <p>requestedAt: {formatDateTime(approval.requestedAt)}</p>
                      <div className="button-row button-row--tight">
                        <button onClick={() => void respondApproval(approval.requestId, true)} disabled={approval.status !== "pending"}>Approve</button>
                        <button onClick={() => void respondApproval(approval.requestId, false)} disabled={approval.status !== "pending"}>Reject</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyHint text="当前没有 approval request。" />
              )}
            </article>
            <article className="info-card">
              <h4>本轮副作用 / 状态变更概况</h4>
              <div className="metric-grid metric-grid--compact">
                <MetricCard label="Trace" value={traces.length} />
                <MetricCard label="StateDiff" value={stateDiffs.length} />
                <MetricCard label="SideEffect" value={sideEffects.length} />
                <MetricCard label="Tool Plan" value={toolExposurePlans.length} />
              </div>
              <div className="summary-list">
                <div className="summary-row">
                  <span>最近 state diff</span>
                  <strong>{stateDiffs[0]?.nodeId || "暂无"}</strong>
                </div>
                <div className="summary-row">
                  <span>最近 side effect</span>
                  <strong>{sideEffects[0]?.type || "暂无"}</strong>
                </div>
                <div className="summary-row">
                  <span>最近 tool exposure adapter</span>
                  <strong>{toolExposurePlans[0]?.adapterKind || "暂无"}</strong>
                </div>
              </div>
            </article>
          </div>
          <RawJsonDetails summary="查看 run / approvals 原始 JSON" value={{ runSummary, approvals }} emptyText="暂无 run 原始数据。" />
        </Card>

        <Card title="实时 Trace 与 Prompt 编译" subtitle="主视图优先展示最近事件和编译摘要，详细 payload 退到原始 JSON。">
          <div className="double-grid">
            <article className="info-card">
              <h4>最近 Trace 事件</h4>
              {recentTraces.length ? (
                <div className="trace-list">
                  {recentTraces.map((trace) => (
                    <article key={trace.eventId} className="trace-card">
                      <div className="trace-card__header">
                        <strong>#{trace.seq} {trace.type}</strong>
                        <span>{formatDateTime(trace.timestamp)}</span>
                      </div>
                      <p>{trace.summary}</p>
                      <div className="badge-list">
                        {trace.nodeId ? <span className="badge">node: {trace.nodeId}</span> : null}
                        {trace.agentId ? <span className="badge">agent: {trace.agentId}</span> : null}
                        {extractCompileId(trace) ? <span className="badge badge--good">compile: {extractCompileId(trace)}</span> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyHint text="暂无 trace。" />
              )}
            </article>
            <article className="info-card">
              <h4>Prompt Compile 摘要</h4>
              {promptCompile ? (
                <div className="detail-stack">
                  <div className="kv-grid">
                    <div><span>compileId</span><strong>{promptCompile.compileId}</strong></div>
                    <div><span>tokenEstimate</span><strong>{promptCompile.promptTrace.tokenEstimate ?? "未提供"}</strong></div>
                    <div><span>selectedUnits</span><strong>{promptCompile.promptTrace.selectedUnits?.length ?? 0}</strong></div>
                    <div><span>finalMessages</span><strong>{promptCompile.finalMessages.length}</strong></div>
                  </div>
                  <article className="info-card info-card--nested">
                    <h4>选中的 PromptUnit</h4>
                    {promptCompile.promptTrace.selectedUnits?.length ? (
                      <div className="stack-grid">
                        {promptCompile.promptTrace.selectedUnits.map((unit, index) => (
                          <div key={`${promptCompile.compileId}-${index}`} className="summary-row summary-row--wrap">
                            <span>{String(unit.unitId ?? unit.id ?? `selected-unit-${index}`)}</span>
                            <strong>{String(unit.insertionPoint ?? unit.kind ?? "unknown")}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyHint text="当前 compile 没有 selectedUnits 明细。" />
                    )}
                  </article>
                </div>
              ) : (
                <EmptyHint text="暂无 prompt compile 详情。" />
              )}
            </article>
          </div>
          <RawJsonDetails summary="查看 trace / prompt compile 原始 JSON" value={{ traces, promptCompile }} emptyText="暂无 trace 原始数据。" />
        </Card>

        <Card title="Checkpoint 实验台" subtitle="这里保留 JSON 输入区，但先把历史 checkpoint 和当前目标节点结构化显示出来。">
          <div className="double-grid">
            <article className="info-card">
              <h4>Checkpoint 历史</h4>
              {historyItems.length ? (
                <div className="stack-grid">
                  {historyItems.map((item) => (
                    <article key={item.checkpointId} className={`checkpoint-card ${latestCheckpoint?.checkpointId === item.checkpointId ? "checkpoint-card--active" : ""}`}>
                      <strong>{item.checkpointId}</strong>
                      <span>{formatDateTime(item.createdAt)}</span>
                      <p>
                        run: {item.runStateSummary?.runId || "未知"} / status: {item.runStateSummary?.status || "未知"} / node: {item.runStateSummary?.currentNodeId || "END"}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyHint text="暂无 history。" />
              )}
            </article>
            <article className="info-card">
              <h4>Checkpoint 操作区</h4>
              <div className="form-grid">
                <label className="wide"><span>State Patch JSON</span><textarea value={statePatchText} onChange={(event) => setStatePatchText(event.target.value)} rows={7} /></label>
                <label className="wide"><span>PromptUnit Override JSON</span><textarea value={promptUnitOverrideText} onChange={(event) => setPromptUnitOverrideText(event.target.value)} rows={7} /></label>
              </div>
              <div className="button-row">
                <button onClick={() => void postAction(`/api/threads/${activeThreadId}/checkpoints/${latestCheckpoint?.checkpointId || ""}/state-patch`, { reason: "dev-console state patch", operator: "dev-console", patch: parseJsonInput(statePatchText) })} disabled={!latestCheckpoint?.checkpointId}>写入 State Patch</button>
                <button onClick={() => void postAction(`/api/threads/${activeThreadId}/checkpoints/${latestCheckpoint?.checkpointId || ""}/prompt-unit-overrides`, { reason: "dev-console prompt-unit override", operator: "dev-console", overrides: parseJsonInput(promptUnitOverrideText) })} disabled={!latestCheckpoint?.checkpointId}>写入 PromptUnit Override</button>
                <button onClick={() => void postAction(`/api/threads/${activeThreadId}/checkpoints/${latestCheckpoint?.checkpointId || ""}/fork`, { operator: "dev-console", reason: "dev-console fork from latest checkpoint" })} disabled={!latestCheckpoint?.checkpointId}>从最新 Checkpoint Fork</button>
              </div>
            </article>
          </div>
          <RawJsonDetails summary="查看 checkpoint / state diff / side effect 原始 JSON" value={{ historyItems, stateDiffs, sideEffects, toolExposurePlans, systemConfig }} emptyText="暂无 checkpoint 原始数据。" />
        </Card>
      </main>
    </div>
  );
}

export default App;
