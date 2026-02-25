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
  CreateRunRequest,
  ForkRunRequest,
  PromptBlock,
  PromptOverridePatchRequest,
  StatePatchRequest,
  ToolSpec,
  WorkflowSpec
} from "../types/index.js";
import type { RuntimeDeps } from "../runtime/index.js";
import { FrameworkRuntimeEngine } from "../runtime/index.js";

interface HttpDeps extends RuntimeDeps {
  engine: FrameworkRuntimeEngine;
}

function sendError(res: Response, status: number, message: string, details?: unknown) {
  res.status(status).json({
    ok: false,
    message,
    details
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function registerHttpRoutes(app: Express, deps: HttpDeps): void {
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "simpagent-observable-backend",
      now: new Date().toISOString()
    });
  });

  app.post("/api/runs", async (req, res) => {
    try {
      const body = asObject(req.body) as Partial<CreateRunRequest>;
      if (!body.workflowId || !body.userInput || !body.provider) {
        sendError(res, 400, "缺少必要字段：workflowId / userInput / provider");
        return;
      }
      const provider = asObject(body.provider) as CreateRunRequest["provider"];
      if (!provider.vendor || !provider.apiMode || !provider.model) {
        sendError(res, 400, "provider 缺少必要字段：vendor / apiMode / model");
        return;
      }
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
      await deps.engine.resumeRun(req.params.runId, (body.resumePayload ?? body) as unknown as any);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "resume 失败");
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

  app.get("/api/prompt-blocks", (_req, res) => {
    res.json({ ok: true, data: deps.db.listPromptBlocks() });
  });

  app.post("/api/prompt-blocks", (req, res) => {
    try {
      const body = req.body as PromptBlock;
      const version = deps.db.saveVersionedConfig("prompt_block", body);
      deps.db.writeAudit("save_prompt_block", "prompt_block", body.id, { version });
      res.json({ ok: true, data: { ...body, version } });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "保存 prompt block 失败");
    }
  });

  app.put("/api/prompt-blocks/:blockId", (req, res) => {
    try {
      const body = { ...(req.body as PromptBlock), id: req.params.blockId } as PromptBlock;
      const version = deps.db.saveVersionedConfig("prompt_block", body);
      deps.db.writeAudit("update_prompt_block", "prompt_block", body.id, { version });
      res.json({ ok: true, data: { ...body, version } });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 prompt block 失败");
    }
  });

  app.get("/api/tools", (_req, res) => {
    res.json({ ok: true, data: deps.toolRegistry.list() });
  });

  app.put("/api/tools/:toolId", (req, res) => {
    try {
      const body = { ...(req.body as ToolSpec), id: req.params.toolId } as ToolSpec;
      const saved = deps.toolRegistry.save(body);
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "更新 tool 失败");
    }
  });

  app.use("/api/*", (_req, res) => {
    sendError(res, 404, "接口不存在");
  });
}

