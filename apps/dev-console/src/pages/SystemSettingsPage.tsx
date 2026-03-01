/**
 * 本文件作用：
 * - System Settings 页面：配置系统默认模型路由、工具暴露策略、内置工具开关。
 * - 提供模板一键应用入口（mededu-default-v1）。
 */

import { useEffect, useState } from "react";
import { apiClient } from "../lib/apiClient";
import { pretty } from "../lib/utils";
import type { BuiltinToolDTO, JsonValue, SettingsDTO, TemplateSummaryDTO } from "../types";

export function SystemSettingsPage() {
  const [systemConfig, setSystemConfig] = useState<SettingsDTO | null>(null);
  const [systemDraft, setSystemDraft] = useState<string>("");
  const [builtinTools, setBuiltinTools] = useState<BuiltinToolDTO[]>([]);
  const [policies, setPolicies] = useState<JsonValue | null>(null);
  const [templates, setTemplates] = useState<TemplateSummaryDTO[]>([]);
  const [message, setMessage] = useState<string>("");

  async function loadAll(): Promise<void> {
    const [configResp, builtinResp, policyResp, templateResp] = await Promise.all([
      apiClient.get<SettingsDTO>("/api/config/system"),
      apiClient.get<BuiltinToolDTO[]>("/api/tools/builtin"),
      apiClient.get<JsonValue>("/api/config/tool-exposure-policies"),
      apiClient.get<TemplateSummaryDTO[]>("/api/templates")
    ]);
    if (configResp.ok && configResp.data) {
      setSystemConfig(configResp.data);
      setSystemDraft(pretty(configResp.data));
    }
    if (builtinResp.ok && Array.isArray(builtinResp.data)) setBuiltinTools(builtinResp.data);
    if (policyResp.ok) setPolicies(policyResp.data ?? null);
    if (templateResp.ok && Array.isArray(templateResp.data)) setTemplates(templateResp.data);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveSystemConfig(): Promise<void> {
    try {
      const parsed = JSON.parse(systemDraft) as Partial<SettingsDTO>;
      const resp = await apiClient.put<SettingsDTO>("/api/config/system", parsed);
      if (!resp.ok || !resp.data) {
        setMessage(`保存失败：${resp.message ?? "未知错误"}`);
        return;
      }
      setSystemConfig(resp.data);
      setSystemDraft(pretty(resp.data));
      setMessage("系统配置已保存");
    } catch (error) {
      setMessage(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function toggleBuiltinTool(tool: BuiltinToolDTO, enabled: boolean): Promise<void> {
    const resp = await apiClient.put(`/api/tools/builtin/${tool.name}`, { enabled });
    if (!resp.ok) {
      setMessage(`更新 ${tool.name} 失败：${resp.message ?? "未知错误"}`);
      return;
    }
    setMessage(`已更新 ${tool.name}`);
    await loadAll();
  }

  async function updateBuiltinAdapter(tool: BuiltinToolDTO, preferredAdapter: string): Promise<void> {
    const resp = await apiClient.put(`/api/tools/builtin/${tool.name}`, {
      exposurePolicy: {
        preferredAdapter
      }
    });
    if (!resp.ok) {
      setMessage(`更新 ${tool.name} 暴露策略失败：${resp.message ?? "未知错误"}`);
      return;
    }
    setMessage(`已更新 ${tool.name} 暴露策略`);
    await loadAll();
  }

  async function applyTemplate(templateId: string): Promise<void> {
    const resp = await apiClient.post(`/api/templates/${templateId}/apply`, {});
    if (!resp.ok) {
      setMessage(`模板应用失败：${resp.message ?? "未知错误"}`);
      return;
    }
    setMessage(`模板 ${templateId} 已应用`);
  }

  return (
    <section className="page">
      <header className="page-header">
        <h2>System Settings</h2>
        <p>系统级参数、工具策略、模板加载。修改后重启服务仍生效（SQLite 持久化）。</p>
      </header>

      <div className="panel-grid two">
        <article className="panel">
          <h3>系统配置（/api/config/system）</h3>
          <textarea className="mono" rows={20} value={systemDraft} onChange={(e) => setSystemDraft(e.target.value)} />
          <div className="row-buttons">
            <button onClick={() => void saveSystemConfig()}>保存系统配置</button>
            <button onClick={() => systemConfig && setSystemDraft(pretty(systemConfig))} disabled={!systemConfig}>
              还原已加载
            </button>
          </div>
          {message ? <p className="hint">{message}</p> : null}
        </article>

        <article className="panel">
          <h3>模板中心（/api/templates）</h3>
          <div className="list">
            {templates.map((tpl) => (
              <div key={tpl.id} className="list-item static">
                <strong>{tpl.name}</strong>
                <small>{tpl.id}</small>
                <p className="hint">{tpl.description}</p>
                <button onClick={() => void applyTemplate(tpl.id)}>应用模板</button>
              </div>
            ))}
          </div>
          <h4>工具暴露策略枚举</h4>
          <pre>{pretty(policies)}</pre>
        </article>
      </div>

      <article className="panel">
        <h3>内置工具配置（/api/tools/builtin）</h3>
        <div className="table">
          <div className="table-row head">
            <span>工具名</span>
            <span>启用</span>
            <span>暴露适配器</span>
            <span>权限配置</span>
          </div>
          {builtinTools.map((tool) => (
            <div key={tool.name} className="table-row">
              <div>
                <strong>{tool.name}</strong>
                <small>{tool.description}</small>
              </div>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={Boolean(tool.runtimeConfig?.enabled)}
                  onChange={(e) => void toggleBuiltinTool(tool, e.target.checked)}
                />
                <span>{tool.runtimeConfig?.enabled ? "ON" : "OFF"}</span>
              </label>
              <select
                value={tool.runtimeConfig?.exposurePolicy?.preferredAdapter ?? ""}
                onChange={(e) => void updateBuiltinAdapter(tool, e.target.value)}
              >
                {["responses_native", "chat_function", "chat_custom", "structured_output_tool_call", "prompt_protocol_fallback"].map(
                  (adapter) => (
                    <option key={adapter} value={adapter}>
                      {adapter}
                    </option>
                  )
                )}
              </select>
              <pre className="cell-pre">{pretty(tool.runtimeConfig?.permissionPolicy ?? {})}</pre>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

