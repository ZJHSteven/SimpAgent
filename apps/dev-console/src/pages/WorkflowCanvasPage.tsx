/**
 * 本文件作用：
 * - Workflow Canvas 页面：管理工作流 JSON 与节点关系概览。
 * - 当前版本先提供“文本编辑 + 节点可视摘要”，后续可平滑升级为拖拽画布。
 */

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../lib/apiClient";
import { pretty } from "../lib/utils";

type WorkflowItem = {
  id?: string;
  name?: string;
  nodes?: Array<{ id?: string; label?: string; agentId?: string; type?: string }>;
  edges?: Array<{ id?: string; from?: string; to?: string; condition?: unknown }>;
  [key: string]: unknown;
};

export function WorkflowCanvasPage() {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  async function loadWorkflows(): Promise<void> {
    const resp = await apiClient.get<WorkflowItem[]>("/api/workflows");
    if (resp.ok && Array.isArray(resp.data)) {
      setWorkflows(resp.data);
      if (!selectedWorkflowId && resp.data.length > 0) {
        const firstId = String(resp.data[0].id ?? "");
        setSelectedWorkflowId(firstId);
        setDraft(pretty(resp.data[0]));
      }
    }
  }

  useEffect(() => {
    void loadWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedWorkflow = useMemo(
    () => workflows.find((item) => String(item.id ?? "") === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId]
  );

  useEffect(() => {
    if (selectedWorkflow) setDraft(pretty(selectedWorkflow));
  }, [selectedWorkflow]);

  async function saveWorkflow(): Promise<void> {
    try {
      const parsed = JSON.parse(draft) as WorkflowItem;
      const id = String(parsed.id ?? "").trim();
      if (!id) {
        setMessage("保存失败：workflow.id 不能为空");
        return;
      }
      const exists = workflows.some((item) => String(item.id ?? "") === id);
      const resp = exists
        ? await apiClient.put(`/api/workflows/${id}`, parsed)
        : await apiClient.post("/api/workflows", parsed);
      if (!resp.ok) {
        setMessage(`保存失败：${resp.message ?? "未知错误"}`);
        return;
      }
      setMessage(`已保存 Workflow：${id}`);
      setSelectedWorkflowId(id);
      await loadWorkflows();
    } catch (error) {
      setMessage(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <h2>Workflow Canvas</h2>
        <p>配置节点、边与路由策略；当前先提供 JSON 编辑与节点摘要，后续可切到图形拖拽。</p>
      </header>
      <div className="panel-grid three">
        <article className="panel">
          <h3>Workflow 列表</h3>
          <div className="list">
            {workflows.map((item) => {
              const id = String(item.id ?? "");
              return (
                <button
                  key={id}
                  className={selectedWorkflowId === id ? "list-item active" : "list-item"}
                  onClick={() => setSelectedWorkflowId(id)}
                >
                  <strong>{String(item.name ?? id)}</strong>
                  <small>{id}</small>
                </button>
              );
            })}
          </div>
        </article>

        <article className="panel">
          <h3>Workflow JSON 编辑</h3>
          <textarea className="mono" rows={26} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row-buttons">
            <button onClick={() => void saveWorkflow()}>保存 Workflow</button>
            <button onClick={() => selectedWorkflow && setDraft(pretty(selectedWorkflow))} disabled={!selectedWorkflow}>
              还原当前选择
            </button>
          </div>
          {message ? <p className="hint">{message}</p> : null}
        </article>

        <article className="panel">
          <h3>节点摘要</h3>
          {!selectedWorkflow ? (
            <p className="hint">请选择一个 workflow。</p>
          ) : (
            <>
              <h4>Nodes</h4>
              <div className="list">
                {(selectedWorkflow.nodes ?? []).map((node) => (
                  <div key={String(node.id ?? Math.random())} className="list-item static">
                    <strong>{String(node.label ?? node.id ?? "")}</strong>
                    <small>
                      {String(node.id ?? "")} · {String(node.type ?? "agent")} · {String(node.agentId ?? "-")}
                    </small>
                  </div>
                ))}
              </div>
              <h4>Edges</h4>
              <pre>{pretty(selectedWorkflow.edges ?? [])}</pre>
            </>
          )}
        </article>
      </div>
    </section>
  );
}

