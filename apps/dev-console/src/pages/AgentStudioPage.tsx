/**
 * 本文件作用：
 * - Agent Studio 页面：管理 Agent、PromptBlock、Tool 三类核心配置。
 * - 提供“读取 + JSON 编辑 + 保存”入口，覆盖框架配置热更新需求。
 */

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../lib/apiClient";
import { pretty } from "../lib/utils";

type ConfigItem = Record<string, unknown>;

const EMPTY_AGENT = {
  id: "agent.demo.new",
  name: "新建代理",
  role: "worker",
  description: "请编辑此代理描述。",
  modelPolicyId: "model.default",
  promptAssemblyPolicyId: "prompt.default",
  contextPolicyId: "context.default",
  toolPolicyId: "toolpolicy.default",
  memoryPolicies: [],
  postChecks: [],
  enabled: true,
  version: 1
};

export function AgentStudioPage() {
  const [agents, setAgents] = useState<ConfigItem[]>([]);
  const [promptBlocks, setPromptBlocks] = useState<ConfigItem[]>([]);
  const [tools, setTools] = useState<ConfigItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [agentDraft, setAgentDraft] = useState<string>(pretty(EMPTY_AGENT));
  const [message, setMessage] = useState<string>("");

  async function loadAll(): Promise<void> {
    const [agentResp, promptResp, toolResp] = await Promise.all([
      apiClient.get<ConfigItem[]>("/api/agents"),
      apiClient.get<ConfigItem[]>("/api/prompt-blocks"),
      apiClient.get<ConfigItem[]>("/api/tools")
    ]);
    if (agentResp.ok && Array.isArray(agentResp.data)) {
      setAgents(agentResp.data);
      if (!selectedAgentId && agentResp.data.length > 0) {
        const firstId = String(agentResp.data[0].id ?? "");
        setSelectedAgentId(firstId);
        setAgentDraft(pretty(agentResp.data[0]));
      }
    }
    if (promptResp.ok && Array.isArray(promptResp.data)) setPromptBlocks(promptResp.data);
    if (toolResp.ok && Array.isArray(toolResp.data)) setTools(toolResp.data);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedAgent = useMemo(
    () => agents.find((item) => String(item.id ?? "") === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    if (selectedAgent) setAgentDraft(pretty(selectedAgent));
  }, [selectedAgent]);

  async function saveAgent(): Promise<void> {
    try {
      const parsed = JSON.parse(agentDraft) as ConfigItem;
      const id = String(parsed.id ?? "").trim();
      if (!id) {
        setMessage("保存失败：agent.id 不能为空");
        return;
      }
      const exists = agents.some((item) => String(item.id ?? "") === id);
      const path = exists ? `/api/agents/${id}` : "/api/agents";
      const resp = exists ? await apiClient.put<ConfigItem>(path, parsed) : await apiClient.post<ConfigItem>(path, parsed);
      if (!resp.ok) {
        setMessage(`保存失败：${resp.message ?? "未知错误"}`);
        return;
      }
      setMessage(`已保存 Agent：${id}`);
      setSelectedAgentId(id);
      await loadAll();
    } catch (error) {
      setMessage(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <h2>Agent Studio</h2>
        <p>定义 Agent、查看 PromptBlock/Tool，并进行框架配置热更新。</p>
      </header>

      <div className="panel-grid three">
        <article className="panel">
          <h3>Agent 列表</h3>
          <div className="list">
            {agents.map((item) => {
              const id = String(item.id ?? "");
              return (
                <button
                  key={id}
                  className={selectedAgentId === id ? "list-item active" : "list-item"}
                  onClick={() => setSelectedAgentId(id)}
                >
                  <strong>{String(item.name ?? id)}</strong>
                  <small>{id}</small>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => {
              setSelectedAgentId("");
              setAgentDraft(pretty(EMPTY_AGENT));
            }}
          >
            新建 Agent 草稿
          </button>
        </article>

        <article className="panel">
          <h3>Agent JSON 编辑</h3>
          <textarea className="mono" rows={26} value={agentDraft} onChange={(e) => setAgentDraft(e.target.value)} />
          <div className="row-buttons">
            <button onClick={() => void saveAgent()}>保存 Agent</button>
            <button onClick={() => selectedAgent && setAgentDraft(pretty(selectedAgent))} disabled={!selectedAgent}>
              还原当前选择
            </button>
          </div>
          {message ? <p className="hint">{message}</p> : null}
        </article>

        <article className="panel">
          <h3>PromptBlock / Tool 只读预览</h3>
          <p className="hint">该页用于快速核对配置是否落库，复杂编辑建议在专用页面进行。</p>
          <h4>PromptBlock（{promptBlocks.length}）</h4>
          <pre>{pretty(promptBlocks)}</pre>
          <h4>Tools（{tools.length}）</h4>
          <pre>{pretty(tools)}</pre>
        </article>
      </div>
    </section>
  );
}

