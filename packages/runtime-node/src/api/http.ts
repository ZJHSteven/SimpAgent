/**
 * 本文件作用：
 * - 注册 HTTP API 路由（控制面 + 查询面）。
 * - 将前端调试器需要的命令操作（run/pause/resume/history/patch/fork）暴露出来。
 *
 * 教学说明：
 * - HTTP 负责“命令与查询”；
 * - WS 负责“实时事件流”；
 * - 两者分工清晰，便于排错和重连恢复。
 */

import type { Express, Request, Response } from "express";
import type {
  AgentSpec,
  BuiltinToolConfig,
  CreateRunRequest,
  ForkRunRequest,
  JsonObject,
  PromptBlock,
  PromptOverridePatchRequest,
  PromptUnitOverridePatchRequest,
  StatePatchRequest,
  WorkflowSpec
} from "../types/index.js";
import type { RuntimeDeps } from "../runtime/index.js";
import { FrameworkRuntimeEngine } from "../runtime/index.js";
import { BUILTIN_TOOL_DEFINITIONS, executeBuiltinApplyPatch, exposureAdapters } from "../core/tools/index.js";
import { applyRuntimeTemplate, listRuntimeTemplates } from "../storage/index.js";

interface HttpDeps extends RuntimeDeps {
  engine: FrameworkRuntimeEngine;
}

/**
 * 统一错误返回格式。
 * 说明：
 * - HTTP 层尽量不要把原始异常对象直接抛给前端；
 * - 这里统一包成 `{ ok: false, message, details }`，便于调试台稳定处理。
 */
function sendError(res: Response, status: number, message: string, details?: unknown) {
  res.status(status).json({
    ok: false,
    message,
    details
  });
}

/**
 * 把未知输入安全收窄为普通对象。
 * 作用：
 * - 避免 `req.body` 是数组 / null / 原始值 时，下面的属性读取直接报错；
 * - 这是一层很轻量的 HTTP 输入防御。
 */
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function registerHttpRoutes(app: Express, deps: HttpDeps): void {
  // ===== 基础健康检查 =====
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "simpagent-observable-backend",
      now: new Date().toISOString()
    });
  });

  // ===== Run 控制面：创建 / 查看 / 暂停 / 恢复 / 中断 =====
  app.post("/api/runs", async (req, res) => {
    try {
      const body = asObject(req.body) as Partial<CreateRunRequest>;
      if (!body.workflowId || !body.userInput) {
        sendError(res, 400, "缺少必要字段：workflowId / userInput");
        return;
      }
      // provider 允许“部分传入 + 系统默认补齐”。
      // 这样前端只改少数字段时，不需要每次都把整套 provider 配置重发一遍。
      const systemConfig = deps.db.getSystemConfig(deps.projectId);
      const providerInput = asObject(body.provider);
      const provider = {
        vendor: typeof providerInput.vendor === "string" ? providerInput.vendor : systemConfig.defaultModelRoute.vendor,
        apiMode:
          providerInput.apiMode === "chat_completions" || providerInput.apiMode === "responses"
            ? providerInput.apiMode
            : systemConfig.defaultModelRoute.apiMode,
        model: typeof providerInput.model === "string" ? providerInput.model : systemConfig.defaultModelRoute.model,
        baseURL:
          typeof providerInput.baseURL === "string" && providerInput.baseURL.trim()
            ? providerInput.baseURL
            : systemConfig.defaultModelRoute.baseURL,
        apiKey: typeof providerInput.apiKey === "string" ? providerInput.apiKey : undefined,
        toolProtocolProfile:
          typeof providerInput.toolProtocolProfile === "string"
            ? providerInput.toolProtocolProfile
            : systemConfig.defaultModelRoute.toolProtocolProfile,
        temperature:
          typeof providerInput.temperature === "number"
            ? providerInput.temperature
            : systemConfig.defaultModelRoute.temperature,
        topP: typeof providerInput.topP === "number" ? providerInput.topP : undefined,
        reasoningConfig:
          providerInput.reasoningConfig && typeof providerInput.reasoningConfig === "object"
            ? (providerInput.reasoningConfig as CreateRunRequest["provider"]["reasoningConfig"])
            : undefined,
        vendorExtra:
          providerInput.vendorExtra && typeof providerInput.vendorExtra === "object"
            ? (providerInput.vendorExtra as CreateRunRequest["provider"]["vendorExtra"])
            : undefined
      } as CreateRunRequest["provider"];
      if (!provider.vendor || !provider.apiMode || !provider.model) {
        sendError(res, 400, "provider 信息不完整，且系统默认模型路由不可用");
        return;
      }
      // 真正的 run 创建逻辑收口在 runtime engine，HTTP 层只负责参数校验与出入口转换。
      const result = await deps.engine.createRun({
        workflowId: body.workflowId,
        workflowVersion: body.workflowVersion,
        userInput: body.userInput,
        provider,
        runConfig: body.runConfig
      });
      res.json({ ok: true, data: result });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "创建 run 失败");
    }
  });

  app.get("/api/runs/:runId", (req, res) => {
    try {
      const row = deps.engine.getRunSummary(req.params.runId);
      if (!row) {
        sendError(res, 404, "run 不存在");
        return;
      }
      res.json({ ok: true, data: row });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "查询 run 失败");
    }
  });

  /**
   * 当前 run 的对话视图。
   * 说明：
   * - 调试台需要一个真正面向“聊天”的读取接口，而不是只靠 trace / JSON 面板拼凑；
   * - 这里直接返回 run 当前 checkpoint 中的 conversationState 摘要。
   */
  app.get("/api/runs/:runId/conversation", async (req, res) => {
    try {
      const data = await deps.engine.getConversationView(req.params.runId);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "查询 run conversation 失败");
    }
  });

  // ===== Run 调试查询面：state diff / side effect / plan / exposure / human input / approval =====
  app.get("/api/runs/:runId/state-diffs", (req, res) => {
    try {
      const limit = Number(req.query.limit ?? 200);
      const data = deps.db.listStateDiffs(req.params.runId, Number.isFinite(limit) ? limit : 200);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "state diff 查询失败");
    }
  });

  app.get("/api/runs/:runId/side-effects", (req, res) => {
    try {
      const limit = Number(req.query.limit ?? 200);
      const data = deps.db.listSideEffects(req.params.runId, Number.isFinite(limit) ? limit : 200);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "side effects 查询失败");
    }
  });

  app.get("/api/runs/:runId/plan", (req, res) => {
    try {
      const data = deps.db.getRunPlan(req.params.runId);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "run plan 查询失败");
    }
  });

  app.get("/api/runs/:runId/tool-exposure-plans", (req, res) => {
    try {
      const limit = Number(req.query.limit ?? 100);
      const data = deps.db.listToolExposurePlanRows(req.params.runId, Number.isFinite(limit) ? limit : 100);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "tool exposure plans 查询失败");
    }
  });

  app.get("/api/runs/:runId/user-input-requests", (req, res) => {
    try {
      const data = deps.db.listUserInputRequestRows(req.params.runId);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "user input requests 查询失败");
    }
  });

  app.get("/api/runs/:runId/approval-requests", (req, res) => {
    try {
      const data = deps.db.listApprovalRequestRows(req.params.runId);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "approval requests 查询失败");
    }
  });

  // ===== Run 状态控制：pause / resume / approval respond / interrupt =====
  app.post("/api/runs/:runId/pause", async (req, res) => {
    try {
      const body = asObject(req.body);
      await deps.engine.requestPause(req.params.runId, typeof body.reason === "string" ? body.reason : "manual_pause");
      res.json({ ok: true });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "pause 失败");
    }
  });

  app.post("/api/runs/:runId/resume", async (req, res) => {
    try {
      const body = asObject(req.body);
      // 兼容两种调用方式：
      // 1. 直接把 payload 放在 body 根上；
      // 2. 显式使用 { resumePayload } 包一层。
      await deps.engine.resumeRun(req.params.runId, (body.resumePayload ?? body) as unknown as any);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "resume 失败");
    }
  });

  app.post("/api/runs/:runId/approval-requests/:requestId/respond", async (req, res) => {
    try {
      const request = deps.db
        .listApprovalRequestRows(req.params.runId)
        .find((item) => item.requestId === req.params.requestId);
      if (!request) {
        sendError(res, 404, "approval request 不存在");
        return;
      }
      if (request.status !== "pending") {
        sendError(res, 400, "approval request 已处理");
        return;
      }
      const body = asObject(req.body);
      // 这里仍然复用 `resumeRun()`，因为审批本质上也是一种“人工恢复执行并带回恢复载荷”。
      await deps.engine.resumeRun(req.params.runId, {
        requestId: req.params.requestId,
        action: typeof body.action === "string" ? body.action : undefined,
        approved: typeof body.approved === "boolean" ? body.approved : undefined,
        justification: typeof body.justification === "string" ? body.justification : undefined
      } as unknown as any);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "approval respond 失败");
    }
  });

  app.post("/api/runs/:runId/interrupt", async (req, res) => {
    try {
      const body = asObject(req.body);
      const reason = typeof body.reason === "string" ? body.reason : "manual_interrupt";
      await deps.engine.requestInterrupt(req.params.runId, reason, (body.payload ?? null) as any);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "interrupt 失败");
    }
  });

  // ===== Checkpoint / Time-travel 能力：history / state patch / prompt patch / fork =====
  app.get("/api/threads/:threadId/history", async (req, res) => {
    try {
      const history = await deps.engine.getThreadHistory(req.params.threadId);
      res.json({ ok: true, data: history });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "history 查询失败");
    }
  });

  app.post("/api/threads/:threadId/checkpoints/:checkpointId/state-patch", async (req, res) => {
    try {
      const body = asObject(req.body) as Partial<StatePatchRequest>;
      if (!body.reason || !body.patch) {
        sendError(res, 400, "缺少 reason 或 patch");
        return;
      }
      await deps.engine.patchStateAtCheckpoint(req.params.threadId, req.params.checkpointId, {
        operator: typeof body.operator === "string" ? body.operator : undefined,
        reason: String(body.reason),
        patch: body.patch as any,
        asNode: typeof body.asNode === "string" ? body.asNode : undefined
      });
      res.json({ ok: true });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "state patch 失败");
    }
  });

  app.post("/api/threads/:threadId/checkpoints/:checkpointId/prompt-overrides", async (req, res) => {
    try {
      const body = asObject(req.body) as Partial<PromptOverridePatchRequest>;
      if (!body.reason || !Array.isArray(body.patches)) {
        sendError(res, 400, "缺少 reason 或 patches");
        return;
      }
      await deps.engine.patchPromptOverridesAtCheckpoint(req.params.threadId, req.params.checkpointId, {
        operator: typeof body.operator === "string" ? body.operator : undefined,
        reason: String(body.reason),
        patches: body.patches as any
      });
      res.json({ ok: true });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "prompt override patch 失败");
    }
  });

  app.post("/api/threads/:threadId/checkpoints/:checkpointId/prompt-unit-overrides", async (req, res) => {
    try {
      const body = asObject(req.body) as Partial<PromptUnitOverridePatchRequest>;
      if (!body.reason || !Array.isArray(body.overrides)) {
        sendError(res, 400, "缺少 reason 或 overrides");
        return;
      }
      await deps.engine.patchPromptUnitOverridesAtCheckpoint(req.params.threadId, req.params.checkpointId, {
        operator: typeof body.operator === "string" ? body.operator : undefined,
        reason: String(body.reason),
        overrides: body.overrides as any
      });
      res.json({ ok: true });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "prompt unit override patch 失败");
    }
  });

  app.post("/api/threads/:threadId/checkpoints/:checkpointId/fork", async (req, res) => {
    try {
      const body = asObject(req.body) as Partial<ForkRunRequest>;
      if (!body.reason) {
        sendError(res, 400, "缺少 reason");
        return;
      }
      const data = await deps.engine.forkRunFromCheckpoint(req.params.threadId, req.params.checkpointId, {
        operator: typeof body.operator === "string" ? body.operator : undefined,
        reason: String(body.reason),
        resumeMode: body.resumeMode,
        resumePayload: body.resumePayload as any
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "fork 失败");
    }
  });

  app.get("/api/trace/:runId/events", (req, res) => {
    try {
      const afterSeq = Number(req.query.afterSeq ?? 0);
      const limit = Number(req.query.limit ?? 200);
      const data = deps.traceBus.replay(req.params.runId, Number.isFinite(afterSeq) ? afterSeq : 0, Number.isFinite(limit) ? limit : 200);
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "trace 查询失败");
    }
  });

  app.get("/api/trace/:runId/prompt/:compileId", async (req, res) => {
    try {
      const data = await deps.engine.getPromptCompile(req.params.compileId);
      if (!data) {
        sendError(res, 404, "prompt compile 不存在");
        return;
      }
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "prompt trace 查询失败");
    }
  });

  // ===== 配置管理（热更新：写新版本，不改旧版本） =====
  app.get("/api/agents", (_req, res) => {
    res.json({ ok: true, data: deps.agentRegistry.list() });
  });

  app.post("/api/agents", (req, res) => {
    try {
      const body = req.body as AgentSpec;
      const saved = deps.agentRegistry.save(body);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "保存 agent 失败");
    }
  });

  app.put("/api/agents/:agentId", (req, res) => {
    try {
      const body = { ...(req.body as AgentSpec), id: req.params.agentId } as AgentSpec;
      const saved = deps.agentRegistry.save(body);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 agent 失败");
    }
  });

  app.get("/api/workflows", (_req, res) => {
    res.json({ ok: true, data: deps.workflowRegistry.list() });
  });

  app.post("/api/workflows", (req, res) => {
    try {
      const body = req.body as WorkflowSpec;
      const saved = deps.workflowRegistry.save(body);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "保存 workflow 失败");
    }
  });

  app.put("/api/workflows/:workflowId", (req, res) => {
    try {
      const body = { ...(req.body as WorkflowSpec), id: req.params.workflowId } as WorkflowSpec;
      const saved = deps.workflowRegistry.save(body);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 workflow 失败");
    }
  });

  // ===== 统一图谱 catalog CRUD =====
  /**
   * v0.4：统一图谱 HTTP CRUD。
   * 说明：
   * - 之前 catalog 只有 DB 层接口，不足以支持调试台做正式编辑；
   * - 这里补齐最小节点/关系/facet 接口。
   */
  app.get("/api/catalog/nodes", (_req, res) => {
    try {
      res.json({ ok: true, data: deps.db.listCatalogNodes(deps.projectId) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "查询 catalog nodes 失败");
    }
  });

  app.get("/api/catalog/nodes/:nodeId", (req, res) => {
    try {
      const node = deps.db.getCatalogNode(req.params.nodeId, deps.projectId);
      if (!node) {
        sendError(res, 404, "catalog node 不存在");
        return;
      }
      res.json({ ok: true, data: node });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "查询 catalog node 失败");
    }
  });

  app.post("/api/catalog/nodes", (req, res) => {
    try {
      const saved = deps.db.saveCatalogNode({
        ...(asObject(req.body) as any),
        projectId: deps.projectId
      });
      deps.db.writeAudit("save_catalog_node", "catalog_node", saved.nodeId, saved as unknown as JsonObject);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "保存 catalog node 失败");
    }
  });

  app.put("/api/catalog/nodes/:nodeId", (req, res) => {
    try {
      const saved = deps.db.saveCatalogNode({
        ...(asObject(req.body) as any),
        nodeId: req.params.nodeId,
        projectId: deps.projectId
      });
      deps.db.writeAudit("update_catalog_node", "catalog_node", saved.nodeId, saved as unknown as JsonObject);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 catalog node 失败");
    }
  });

  app.delete("/api/catalog/nodes/:nodeId", (req, res) => {
    try {
      deps.db.deleteCatalogNode(req.params.nodeId);
      deps.db.writeAudit("delete_catalog_node", "catalog_node", req.params.nodeId);
      res.json({ ok: true, data: { nodeId: req.params.nodeId } });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "删除 catalog node 失败");
    }
  });

  app.get("/api/catalog/nodes/:nodeId/facets", (req, res) => {
    try {
      res.json({ ok: true, data: deps.db.listCatalogFacetsByNodeId(req.params.nodeId) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "查询 catalog facets 失败");
    }
  });

  app.put("/api/catalog/nodes/:nodeId/facets/:facetType", (req, res) => {
    try {
      const body = asObject(req.body);
      const payload = asObject(body.payload ?? body) as any;
      const saved = deps.db.saveCatalogFacet({
        facetId: typeof body.facetId === "string" ? body.facetId : `facet.${req.params.facetType}.${req.params.nodeId}`,
        nodeId: req.params.nodeId,
        facetType: req.params.facetType as any,
        payload,
        updatedAt: new Date().toISOString()
      });
      deps.db.writeAudit("save_catalog_facet", "catalog_facet", saved.facetId, saved as unknown as JsonObject);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "保存 catalog facet 失败");
    }
  });

  app.delete("/api/catalog/nodes/:nodeId/facets/:facetType", (req, res) => {
    try {
      deps.db.deleteCatalogFacet(req.params.nodeId, req.params.facetType as any);
      deps.db.writeAudit("delete_catalog_facet", "catalog_facet", `${req.params.nodeId}:${req.params.facetType}`);
      res.json({ ok: true, data: { nodeId: req.params.nodeId, facetType: req.params.facetType } });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "删除 catalog facet 失败");
    }
  });

  app.get("/api/catalog/relations", (_req, res) => {
    try {
      res.json({ ok: true, data: deps.db.listCatalogRelations(deps.projectId) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "查询 catalog relations 失败");
    }
  });

  app.post("/api/catalog/relations", (req, res) => {
    try {
      const saved = deps.db.saveCatalogRelation({
        ...(asObject(req.body) as any),
        projectId: deps.projectId
      });
      deps.db.writeAudit("save_catalog_relation", "catalog_relation", saved.relationId, saved as unknown as JsonObject);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "保存 catalog relation 失败");
    }
  });

  app.put("/api/catalog/relations/:relationId", (req, res) => {
    try {
      const saved = deps.db.saveCatalogRelation({
        ...(asObject(req.body) as any),
        relationId: req.params.relationId,
        projectId: deps.projectId
      });
      deps.db.writeAudit("update_catalog_relation", "catalog_relation", saved.relationId, saved as unknown as JsonObject);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 catalog relation 失败");
    }
  });

  app.delete("/api/catalog/relations/:relationId", (req, res) => {
    try {
      deps.db.deleteCatalogRelation(req.params.relationId);
      deps.db.writeAudit("delete_catalog_relation", "catalog_relation", req.params.relationId);
      res.json({ ok: true, data: { relationId: req.params.relationId } });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "删除 catalog relation 失败");
    }
  });

  app.get("/api/catalog/prompt-units", (_req, res) => {
    try {
      res.json({ ok: true, data: deps.db.listCatalogPromptUnits(deps.projectId) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "查询 catalog prompt units 失败");
    }
  });

  app.get("/api/catalog/context-prompt-units", (_req, res) => {
    try {
      res.json({ ok: true, data: deps.db.listCatalogContextPromptUnits(deps.projectId) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "查询 catalog context prompt units 失败");
    }
  });

  /**
   * PromptUnit 保存辅助函数。
   * 说明：
   * - 新旧路由（`prompt-units` / `prompt-blocks`）最终都走这里；
   * - 这样可以保证审计、版本化语义完全一致。
   */
  const savePromptUnit = (body: PromptBlock) => {
    const version = deps.db.saveVersionedConfig("prompt_block", body);
    deps.db.writeAudit("save_prompt_unit", "prompt_unit", body.id, { version });
    return { ...body, version };
  };

  app.get("/api/prompt-units", (_req, res) => {
    res.json({ ok: true, data: deps.db.listPromptUnits() });
  });
  app.post("/api/prompt-units", (req, res) => {
    try {
      res.json({ ok: true, data: savePromptUnit(req.body as PromptBlock) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "保存 PromptUnit 失败");
    }
  });
  app.put("/api/prompt-units/:unitId", (req, res) => {
    try {
      const body = { ...(req.body as PromptBlock), id: req.params.unitId } as PromptBlock;
      res.json({ ok: true, data: savePromptUnit(body) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 PromptUnit 失败");
    }
  });

  // 兼容旧路由：prompt-blocks -> prompt-units
  app.get("/api/prompt-blocks", (_req, res) => {
    res.json({ ok: true, data: deps.db.listPromptUnits() });
  });
  app.post("/api/prompt-blocks", (req, res) => {
    try {
      res.json({ ok: true, data: savePromptUnit(req.body as PromptBlock) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "保存 prompt block 失败");
    }
  });
  app.put("/api/prompt-blocks/:blockId", (req, res) => {
    try {
      const body = { ...(req.body as PromptBlock), id: req.params.blockId } as PromptBlock;
      res.json({ ok: true, data: savePromptUnit(body) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 prompt block 失败");
    }
  });

  // ===== Tool 查询与配置 =====
  app.get("/api/tools", (_req, res) => {
    res.json({ ok: true, data: deps.toolRegistry.list() });
  });

  /**
   * v0.3：返回首批 builtin tools 定义 + 当前运行时配置（SQLite 持久化，可热更新）。
   * 说明：
   * - 配置按 project_id 隔离；
   * - 重启后仍可保持工具开关和暴露策略。
   */
  app.get("/api/tools/builtin", (_req, res) => {
    const defs = deps.toolRegistry.listBuiltinDefinitions();
    const cfgMap = new Map(deps.toolRegistry.listBuiltinConfigs().map((cfg) => [cfg.name, cfg]));
    res.json({
      ok: true,
      data: defs.map((def) => ({
        ...def,
        runtimeConfig:
          cfgMap.get(def.name) ?? {
            name: def.name,
            enabled: true,
            description: def.description,
            exposurePolicy: def.exposurePolicy,
            permissionPolicy: def.permissionPolicy
          }
      }))
    });
  });

  app.put("/api/tools/builtin/:name", (req, res) => {
    try {
      const name = req.params.name;
      const def = deps.toolRegistry.getBuiltinDefinition(name);
      if (!def) {
        sendError(res, 404, "builtin tool 不存在");
        return;
      }
      const body = asObject(req.body);
      const current = deps.toolRegistry.getBuiltinConfig(name) ?? {
        name: def.name,
        enabled: true,
        description: def.description,
        exposurePolicy: def.exposurePolicy,
        permissionPolicy: def.permissionPolicy
      };
      const next: BuiltinToolConfig = {
        ...current,
        ...(body as Partial<BuiltinToolConfig>),
        name: def.name,
        exposurePolicy: {
          ...current.exposurePolicy,
          ...(asObject(body.exposurePolicy) as Partial<BuiltinToolConfig["exposurePolicy"]>)
        },
        permissionPolicy: {
          ...current.permissionPolicy,
          ...(asObject(body.permissionPolicy) as Partial<BuiltinToolConfig["permissionPolicy"]>)
        }
      };
      const saved = deps.toolRegistry.saveBuiltinConfig(next);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 builtin tool 配置失败");
    }
  });

  /**
   * v0.2：apply_patch dry-run 调试接口（不写文件）。
   */
  app.post("/api/tools/apply-patch/dry-run", async (req, res) => {
    try {
      const body = asObject(req.body);
      const patch = typeof body.patch === "string" ? body.patch : "";
      if (!patch.trim()) {
        sendError(res, 400, "缺少 patch 文本");
        return;
      }
      const result = await executeBuiltinApplyPatch(
        {
          patch,
          dry_run: true
        } as JsonObject,
        {
          workspaceRoot: deps.workspaceRoot
        }
      );
      res.json({ ok: true, data: result });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "apply_patch dry-run 失败");
    }
  });

  // ===== 系统配置 / 暴露策略元信息 =====
  /**
   * v0.2：暴露适配策略枚举，供前端工具策略面板显示。
   */
  app.get("/api/config/tool-exposure-policies", (_req, res) => {
    res.json({
      ok: true,
      data: {
        adapters: Object.keys(exposureAdapters),
        builtinDefaults: BUILTIN_TOOL_DEFINITIONS.map((item) => ({
          name: item.name,
          preferredAdapter: item.exposurePolicy.preferredAdapter,
          fallbackAdapters: item.exposurePolicy.fallbackAdapters,
          exposureLevel: item.exposurePolicy.exposureLevel
        }))
      }
    });
  });

  /**
   * v0.3：系统级设置（模型默认路由、上下文窗口、日志上限）。
   * 说明：
   * - 此配置属于“用户覆盖层（SQLite Override）”；
   * - Preset 在代码中，Runtime Patch 在 run 创建时临时覆盖。
   */
  app.get("/api/config/system", (_req, res) => {
    try {
      const data = deps.db.getSystemConfig(deps.projectId);
      res.json({
        ok: true,
        data,
        meta: {
          projectId: deps.projectId,
          layers: ["preset", "sqlite_override", "runtime_patch"],
          priority: "runtime_patch > sqlite_override > preset"
        }
      });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "读取系统配置失败");
    }
  });

  app.put("/api/config/system", (req, res) => {
    try {
      const body = asObject(req.body);
      const saved = deps.db.upsertSystemConfig(body as any, deps.projectId);
      deps.db.writeAudit("update_system_config", "system_config", deps.projectId, saved as unknown as JsonObject);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新系统配置失败");
    }
  });

  // ===== 模板能力 =====
  app.get("/api/templates", (_req, res) => {
    try {
      const data = listRuntimeTemplates();
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "读取模板列表失败");
    }
  });

  app.post("/api/templates/:templateId/apply", (req, res) => {
    try {
      const result = applyRuntimeTemplate(deps.db, req.params.templateId);
      deps.agentRegistry.refresh();
      deps.workflowRegistry.refresh();
      deps.toolRegistry.refresh();
      res.json({
        ok: true,
        data: {
          ...result,
          projectId: deps.projectId
        }
      });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "应用模板失败");
    }
  });

  app.use("/api/*", (_req, res) => {
    sendError(res, 404, "接口不存在");
  });
}
