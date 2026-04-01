/**
 * 文件作用：
 * - 作为“框架调试台”前端入口。
 * - 直接连接 `@simpagent/runtime-node` 现有 HTTP / WS 接口，
 *   把框架能力暴露成一个可操作的烟雾测试面板。
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

function WorkflowGraph(props: { workflow: WorkflowSummary | null }) {
  if (!props.workflow) return <div className="empty-hint">当前没有 workflow。</div>;
  return (
    <div className="workflow-graph">
      {props.workflow.nodes.map((node) => (
        <article key={node.id} className="node-card">
          <strong>{node.label || node.id}</strong>
          <span>{node.type}</span>
          <p>{node.agentId ?? node.toolId ?? "未绑定实体"}</p>
        </article>
      ))}
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
  const [statusText, setStatusText] = useState("尚未加载框架资源。");
  const [errorText, setErrorText] = useState("");

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
  const [promptUnitOverrideText, setPromptUnitOverrideText] = useState('[\n  {\n    "overrideId": "override.sample.sort",\n    "unitId": "block.default.system",\n    "action": "change_sort",\n    "payload": {\n      "priority": 999\n    }\n  }\n]');
  const lastEventSeqRef = useRef(0);

  const selectedWorkflow = useMemo(() => workflows.find((item) => item.id === selectedWorkflowId) ?? null, [selectedWorkflowId, workflows]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.runtimeBaseUrl, runtimeBaseUrl);
    window.localStorage.setItem(STORAGE_KEYS.wsUrl, wsUrl);
    window.localStorage.setItem(STORAGE_KEYS.provider, JSON.stringify(providerForm));
    window.localStorage.setItem(STORAGE_KEYS.runInput, runInput);
  }, [runtimeBaseUrl, wsUrl, providerForm, runInput]);

  async function loadInventory() {
    try {
      const [nextHealth, nextAgents, nextWorkflows, nextPromptUnits, nextBuiltinTools, nextCatalogNodes, nextCatalogRelations, nextTemplates, nextSystemConfig, nextExposureMeta] = await Promise.all([
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

  async function createRun() {
    if (!selectedWorkflowId) return setErrorText("请先选择 workflow。");
    if (!providerForm.model.trim()) return setErrorText("请填写模型名（model）。");
    try {
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
      setSelectedCompileId("");
      lastEventSeqRef.current = 0;
      setStatusText(`已创建真实 run：${created.runId}`);
      await loadRunViews(created.runId, created.threadId);
    } catch (error) {
      setErrorText(toErrorMessage(error));
    }
  }

  async function postAction(path: string, body: Record<string, unknown>) {
    try {
      await requestJson<Record<string, unknown>>(runtimeBaseUrl, path, withJsonBody(body));
      await loadRunViews(activeRunId, activeThreadId);
    } catch (error) {
      setErrorText(toErrorMessage(error));
    }
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
  }, [activeRunId, wsUrl]);

  return (
    <div className="console-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Framework Smoke Bench</p>
          <h1>SimpAgent 框架调试台</h1>
          <p className="hero__summary">这里不讲业务故事，只直接暴露 Prompt、Workflow、Tool、Catalog、Trace、Approval、Fork、Patch 和真实 LLM 接口入口。</p>
        </div>
        <div className="hero__meta">
          <span className="pill">HTTP：{health ? "已连接" : "未连接"}</span>
          <span className="pill">WS：{wsState}</span>
          <span className="pill">Run：{runSummary?.status ?? "未创建"}</span>
        </div>
      </header>

      <section className="status-bar">
        <span>{statusText}</span>
        {errorText ? <strong>{errorText}</strong> : null}
      </section>

      <main className="grid">
        <Card title="真实 LLM 与运行入口" subtitle="这里保留 OpenAI-compatible 配置口，不把 mock 当成调试台默认方案。">
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
            <button onClick={() => void requestJson<Record<string, unknown>>(runtimeBaseUrl, `/api/templates/${selectedTemplateId}/apply`, withJsonBody({})).then(loadInventory).catch((error) => setErrorText(toErrorMessage(error)))} disabled={!selectedTemplateId}>应用模板</button>
            <button className="primary" onClick={() => void createRun()}>创建真实 Run</button>
          </div>
        </Card>

        <Card title="库存总览" subtitle="后续 AI / 人类开发者优先看这里，确认框架现成能力。">
          <div className="stats">
            {[
              ["Agents", agents.length],
              ["Workflows", workflows.length],
              ["PromptUnits", promptUnits.length],
              ["Builtin Tools", builtinTools.length],
              ["Catalog Nodes", catalogNodes.length],
              ["Relations", catalogRelations.length]
            ].map(([label, count]) => <article key={label}><strong>{count}</strong><span>{label}</span></article>)}
          </div>
          <div className="split">
            <JsonPanel value={{ agents, promptUnits }} emptyText="暂无 agents / promptUnits。" />
            <JsonPanel value={{ builtinTools, toolExposureMeta }} emptyText="暂无 tools。" />
          </div>
        </Card>

        <Card title="Workflow / Catalog 结构视图" subtitle="先看当前统一拓扑是否接上线。">
          <WorkflowGraph workflow={selectedWorkflow} />
          <div className="split">
            <JsonPanel value={catalogNodes} emptyText="暂无 catalog nodes。" />
            <JsonPanel value={catalogRelations} emptyText="暂无 catalog relations。" />
          </div>
        </Card>

        <Card title="当前 Run 控制" subtitle="支持刷新、暂停、恢复、中断、审批，验证 human-in-the-loop 主链。">
          {runSummary ? <div className="button-row"><span className="pill">{runSummary.run_id}</span><span className="pill">{runSummary.current_node_id ?? "END"}</span><span className="pill">{runSummary.status}</span><button onClick={() => void loadRunViews()}>刷新 Run</button><button onClick={() => void postAction(`/api/runs/${activeRunId}/pause`, { reason: "dev-console pause" })}>Pause</button><button onClick={() => void postAction(`/api/runs/${activeRunId}/resume`, { resumePayload: { source: "dev-console" } })}>Resume</button><button onClick={() => void postAction(`/api/runs/${activeRunId}/interrupt`, { reason: "dev-console interrupt", payload: { source: "dev-console" } })}>Interrupt</button></div> : <div className="empty-hint">尚未创建 run。</div>}
          <JsonPanel value={approvals} emptyText="当前没有 approval request。" />
        </Card>

        <Card title="实时 Trace 与 Prompt 编译" subtitle="trace 事件会通过 WS 实时补进来；带 compileId 的事件会触发 prompt 明细拉取。">
          <div className="split">
            <JsonPanel value={traces} emptyText="暂无 trace。" />
            <JsonPanel value={promptCompile} emptyText="暂无 prompt compile 详情。" />
          </div>
        </Card>

        <Card title="Checkpoint 实验台" subtitle="这里直接验证 state patch、prompt unit override、fork。">
          <JsonPanel value={historyItems} emptyText="暂无 history。" />
          <div className="form-grid">
            <label className="wide"><span>State Patch JSON</span><textarea value={statePatchText} onChange={(event) => setStatePatchText(event.target.value)} rows={7} /></label>
            <label className="wide"><span>PromptUnit Override JSON</span><textarea value={promptUnitOverrideText} onChange={(event) => setPromptUnitOverrideText(event.target.value)} rows={7} /></label>
          </div>
          <div className="button-row">
            <button onClick={() => void postAction(`/api/threads/${activeThreadId}/checkpoints/${historyItems[0]?.checkpointId || ""}/state-patch`, { reason: "dev-console state patch", operator: "dev-console", patch: parseJsonInput(statePatchText) })} disabled={!historyItems[0]?.checkpointId}>写入 State Patch</button>
            <button onClick={() => void postAction(`/api/threads/${activeThreadId}/checkpoints/${historyItems[0]?.checkpointId || ""}/prompt-unit-overrides`, { reason: "dev-console prompt-unit override", operator: "dev-console", overrides: parseJsonInput(promptUnitOverrideText) })} disabled={!historyItems[0]?.checkpointId}>写入 PromptUnit Override</button>
            <button onClick={() => void postAction(`/api/threads/${activeThreadId}/checkpoints/${historyItems[0]?.checkpointId || ""}/fork`, { operator: "dev-console", reason: "dev-console fork from latest checkpoint" })} disabled={!historyItems[0]?.checkpointId}>从最新 Checkpoint Fork</button>
          </div>
        </Card>

        <Card title="State Diff / Side Effect / Tool Exposure / System" subtitle="检查每个节点到底改了什么，而不是只看最后一句输出。">
          <div className="split split--quad">
            <JsonPanel value={stateDiffs} emptyText="暂无 state diff。" />
            <JsonPanel value={sideEffects} emptyText="暂无 side effects。" />
            <JsonPanel value={toolExposurePlans} emptyText="暂无 tool exposure plan。" />
            <JsonPanel value={systemConfig} emptyText="暂无 system config。" />
          </div>
        </Card>
      </main>
    </div>
  );
}

export default App;
