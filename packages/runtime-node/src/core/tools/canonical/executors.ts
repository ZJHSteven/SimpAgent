/**
 * 本文件作用：
 * - 提供基于 catalog 的结构化工具执行器。
 * - 让 runtime 可以直接执行 canonical `mcp / skill_tool`，而不是先退化成 shell 文本再绕回内部桥接。
 *
 * 教学说明：
 * - 这里专门处理“已知工具节点如何执行”；
 * - `InternalShellBridge` 只负责解析 `simpagent ...` 命令文本，然后复用本文件；
 * - 这样 runtime 主链与 shell 兼容入口最终共用同一套 schema 校验、MCP 连接、skill spawn 逻辑。
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CatalogIntegrationFacetPayload,
  CatalogNode,
  CatalogNodeFacet,
  CatalogToolFacetPayload,
  CanonicalToolSideEffectRecord,
  CanonicalToolSpec,
  JsonObject,
  JsonValue,
  ToolResult,
  ToolTrace
} from "../../../types/index.js";
import type { AppDatabase } from "../../../storage/index.js";

export interface StructuredToolExecutionContext {
  runId: string;
  threadId: string;
  nodeId?: string;
  agentId?: string;
  toolCallId: string;
  toolId: string;
  toolName: string;
  workspaceRoot: string;
}

export interface StructuredToolExecutionResult {
  toolResult: ToolResult;
  toolTrace: ToolTrace;
  sideEffects: CanonicalToolSideEffectRecord[];
}

interface CatalogToolExecutorDeps {
  projectId: string;
  db: AppDatabase;
  workspaceRoot: string;
}

interface SchemaValidationIssue {
  path: string;
  message: string;
}

interface McpClientHandle {
  client: Client;
  close: () => Promise<void>;
  transportLabel: string;
  transportTarget: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return isJsonObject(value) ? (value as Record<string, unknown>) : {};
}

function asToolFacet(facet: CatalogNodeFacet | null | undefined): CatalogToolFacetPayload | null {
  if (!facet || facet.facetType !== "tool") return null;
  return facet.payload as CatalogToolFacetPayload;
}

function asIntegrationFacet(facet: CatalogNodeFacet | null | undefined): CatalogIntegrationFacetPayload | null {
  if (!facet || facet.facetType !== "integration") return null;
  return facet.payload as CatalogIntegrationFacetPayload;
}

function truncateText(value: string, maxLength = 2000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...(truncated)`;
}

function validateSchemaValue(value: JsonValue | undefined, schema: unknown, pathExpr: string, issues: SchemaValidationIssue[]): void {
  if (!isJsonObject(schema)) return;
  const schemaType = typeof schema.type === "string" ? String(schema.type) : undefined;
  if (value === undefined) return;

  if (schema.enum && Array.isArray(schema.enum)) {
    const matched = schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value));
    if (!matched) {
      issues.push({ path: pathExpr, message: `值不在 enum 允许范围内：${JSON.stringify(schema.enum)}` });
      return;
    }
  }

  if (!schemaType) return;
  if (schemaType === "string" && typeof value !== "string") {
    issues.push({ path: pathExpr, message: "必须是字符串" });
    return;
  }
  if (schemaType === "number" && typeof value !== "number") {
    issues.push({ path: pathExpr, message: "必须是数字" });
    return;
  }
  if (schemaType === "integer" && (!Number.isInteger(value) || typeof value !== "number")) {
    issues.push({ path: pathExpr, message: "必须是整数" });
    return;
  }
  if (schemaType === "boolean" && typeof value !== "boolean") {
    issues.push({ path: pathExpr, message: "必须是布尔值" });
    return;
  }
  if (schemaType === "array") {
    if (!Array.isArray(value)) {
      issues.push({ path: pathExpr, message: "必须是数组" });
      return;
    }
    for (let index = 0; index < value.length; index += 1) {
      validateSchemaValue(value[index] as JsonValue, schema.items, `${pathExpr}[${index}]`, issues);
    }
    return;
  }
  if (schemaType === "object") {
    if (!isJsonObject(value)) {
      issues.push({ path: pathExpr, message: "必须是对象" });
      return;
    }
    const properties = isJsonObject(schema.properties) ? (schema.properties as Record<string, unknown>) : {};
    const required = Array.isArray(schema.required) ? schema.required.map((item) => String(item)) : [];
    for (const requiredKey of required) {
      if (!(requiredKey in value)) {
        issues.push({ path: pathExpr ? `${pathExpr}.${requiredKey}` : requiredKey, message: "缺少必填字段" });
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      validateSchemaValue(value[key] as JsonValue | undefined, propertySchema, pathExpr ? `${pathExpr}.${key}` : key, issues);
    }
  }
}

function validateArgsAgainstSchema(args: JsonObject, schema: JsonObject | undefined): SchemaValidationIssue[] {
  if (!schema) return [];
  const issues: SchemaValidationIssue[] = [];
  validateSchemaValue(args, schema, "", issues);
  return issues;
}

function formatSchemaIssues(issues: SchemaValidationIssue[]): JsonValue {
  return issues.map((item) => ({
    path: item.path || "$",
    message: item.message
  })) as JsonValue;
}

abstract class BaseCatalogToolExecutor {
  constructor(protected readonly deps: CatalogToolExecutorDeps) {}

  protected buildSideEffects(
    ctx: StructuredToolExecutionContext,
    entries: Array<{
      type: CanonicalToolSideEffectRecord["type"];
      target?: string;
      summary: string;
      details?: JsonValue;
    }>
  ): CanonicalToolSideEffectRecord[] {
    return entries.map((entry) => ({
      sideEffectId: newId("sfx"),
      runId: ctx.runId,
      threadId: ctx.threadId,
      nodeId: ctx.nodeId,
      agentId: ctx.agentId,
      type: entry.type,
      target: entry.target,
      summary: entry.summary,
      details: entry.details,
      timestamp: nowIso()
    }));
  }

  protected buildFailureResult(
    ctx: StructuredToolExecutionContext,
    executorType: ToolTrace["executorType"],
    errorCode: string,
    message: string,
    details?: JsonValue
  ): StructuredToolExecutionResult {
    const startedAt = nowIso();
    const finishedAt = nowIso();
    const toolResult: ToolResult = {
      toolCallId: ctx.toolCallId,
      toolId: ctx.toolId,
      ok: false,
      error: {
        code: errorCode,
        message,
        details
      },
      startedAt,
      finishedAt,
      durationMs: 0
    };
    return {
      toolResult,
      toolTrace: {
        toolCallId: ctx.toolCallId,
        toolId: ctx.toolId,
        toolName: ctx.toolName,
        executorType,
        arguments: {},
        result: toolResult,
        workingDir: ctx.workspaceRoot
      },
      sideEffects: this.buildSideEffects(ctx, [
        {
          type: "tool_exec",
          target: ctx.toolName,
          summary: `${ctx.toolName} 执行失败`,
          details: details ?? { code: errorCode, message }
        }
      ])
    };
  }

  protected resolveCatalogNode(nodeRef: string, expectedKinds: Array<CatalogNode["primaryKind"]>): CatalogNode {
    const directNode = this.deps.db.getCatalogNode(nodeRef, this.deps.projectId);
    if (directNode) {
      if (expectedKinds.length === 0 || expectedKinds.includes(directNode.primaryKind ?? "generic")) return directNode;
      throw new Error(`节点 ${nodeRef} 类型不匹配，期望：${expectedKinds.join(", ")}`);
    }
    const allNodes = this.deps.db.listCatalogNodes(this.deps.projectId);
    const matched = allNodes.find((item) => item.name === nodeRef || item.title === nodeRef);
    if (!matched) throw new Error(`找不到图谱节点：${nodeRef}`);
    if (expectedKinds.length > 0 && !expectedKinds.includes(matched.primaryKind ?? "generic")) {
      throw new Error(`节点 ${nodeRef} 类型不匹配，期望：${expectedKinds.join(", ")}`);
    }
    return matched;
  }

  protected resolveCommandCwd(rawCwd: string | undefined, workspaceRoot: string): string {
    if (!rawCwd) return workspaceRoot;
    return path.isAbsolute(rawCwd) ? rawCwd : path.resolve(workspaceRoot, rawCwd);
  }

  protected normalizeHeaders(value: unknown): HeadersInit | undefined {
    if (!isJsonObject(value)) return undefined;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
  }

  protected async spawnProcess(input: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; parsedStdout?: JsonValue }> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill("SIGKILL");
        reject(new Error(`skill 命令执行超时（>${input.timeoutMs}ms）`));
      }, input.timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const trimmed = stdout.trim();
        let parsedStdout: JsonValue | undefined;
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            parsedStdout = JSON.parse(trimmed) as JsonValue;
          } catch {
            parsedStdout = undefined;
          }
        }
        resolve({
          stdout,
          stderr,
          exitCode: Number(code ?? -1),
          parsedStdout
        });
      });
    });
  }
}

export class McpToolExecutor extends BaseCatalogToolExecutor {
  async executeCanonicalTool(input: {
    tool: CanonicalToolSpec;
    args: JsonObject;
    ctx: StructuredToolExecutionContext;
  }): Promise<StructuredToolExecutionResult> {
    if (input.tool.routeTarget.kind !== "mcp") {
      return this.buildFailureResult(input.ctx, "mcp_proxy", "MCP_ROUTE_INVALID", "canonical tool 不是 mcp 路由");
    }
    return this.executeResolvedTool({
      serverRef: input.tool.routeTarget.server,
      remoteToolName: input.tool.routeTarget.tool,
      toolNodeRef: typeof input.tool.sourceMeta?.nodeId === "string" ? String(input.tool.sourceMeta.nodeId) : undefined,
      args: input.args,
      ctx: input.ctx,
      traceLabel: `canonical:${input.tool.name}`
    });
  }

  async executeBridgeCommand(input: {
    serverRef: string;
    toolName: string;
    args: JsonObject;
    rawCommand: string;
    ctx: StructuredToolExecutionContext;
  }): Promise<StructuredToolExecutionResult> {
    return this.executeResolvedTool({
      serverRef: input.serverRef,
      remoteToolName: input.toolName,
      args: input.args,
      ctx: input.ctx,
      traceLabel: input.rawCommand
    });
  }

  private resolveMcpToolNode(serverNodeId: string, toolName: string): CatalogNode {
    const nodes = this.deps.db.listCatalogNodes(this.deps.projectId);
    const facets = this.deps.db.listCatalogNodeFacets(this.deps.projectId);
    const facetByNode = new Map<string, CatalogNodeFacet[]>();
    for (const facet of facets) {
      const list = facetByNode.get(facet.nodeId) ?? [];
      list.push(facet);
      facetByNode.set(facet.nodeId, list);
    }

    const exactNode = nodes.find((node) => {
      if (node.primaryKind !== "mcp") return false;
      const toolFacet = asToolFacet(facetByNode.get(node.nodeId)?.find((item) => item.facetType === "tool"));
      if (!toolFacet || toolFacet.toolKind !== "mcp") return false;
      const executionConfig = toRecord(toolFacet.executionConfig);
      const route = toolFacet.route?.kind === "mcp" ? toolFacet.route : null;
      const remoteName =
        typeof executionConfig.toolName === "string" && executionConfig.toolName.trim()
          ? executionConfig.toolName.trim()
          : route?.toolName ?? node.name;
      const facetServerNodeId =
        typeof executionConfig.serverNodeId === "string" && executionConfig.serverNodeId.trim()
          ? executionConfig.serverNodeId.trim()
          : route?.serverNodeId;
      return facetServerNodeId === serverNodeId && remoteName === toolName;
    });
    if (!exactNode) {
      throw new Error(`找不到 MCP tool 节点：server=${serverNodeId}, tool=${toolName}`);
    }
    return exactNode;
  }

  private async openMcpClient(
    serverNode: CatalogNode,
    integrationFacet: CatalogIntegrationFacetPayload
  ): Promise<McpClientHandle> {
    const client = new Client({ name: "simpagent-canonical-mcp", version: "0.1.0" });
    const clientConfig = toRecord(integrationFacet.clientConfig);
    const transport = integrationFacet.transport ?? "stdio";

    if (transport === "stdio") {
      const command = typeof clientConfig.command === "string" ? clientConfig.command : "";
      if (!command) throw new Error(`MCP server ${serverNode.nodeId} 缺少 stdio command`);
      const args = Array.isArray(clientConfig.args) ? clientConfig.args.map((item) => String(item)) : [];
      const env = isJsonObject(clientConfig.env)
        ? Object.fromEntries(Object.entries(clientConfig.env).map(([key, value]) => [key, String(value)]))
        : undefined;
      const cwd =
        typeof clientConfig.cwd === "string" ? this.resolveCommandCwd(clientConfig.cwd, this.deps.workspaceRoot) : undefined;
      const stdioTransport = new StdioClientTransport({
        command,
        args,
        env,
        cwd,
        stderr: "pipe"
      });
      await client.connect(stdioTransport);
      return {
        client,
        close: async () => {
          await client.close();
        },
        transportLabel: "stdio",
        transportTarget: command
      };
    }

    const urlText = typeof clientConfig.url === "string" ? clientConfig.url : "";
    if (!urlText) throw new Error(`MCP server ${serverNode.nodeId} 缺少连接 URL`);
    const endpoint = new URL(urlText);

    if (transport === "streamable-http") {
      const httpTransport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: {
          headers: this.normalizeHeaders(clientConfig.headers)
        }
      });
      await client.connect(httpTransport);
      return {
        client,
        close: async () => {
          try {
            await httpTransport.terminateSession();
          } catch {
            // 某些 server 不支持显式终止 session，这里不影响主流程。
          }
          await client.close();
        },
        transportLabel: "streamable-http",
        transportTarget: endpoint.toString()
      };
    }

    if (transport === "sse") {
      const sseTransport = new SSEClientTransport(endpoint, {
        requestInit: {
          headers: this.normalizeHeaders(clientConfig.headers)
        }
      });
      await client.connect(sseTransport);
      return {
        client,
        close: async () => {
          await client.close();
        },
        transportLabel: "sse",
        transportTarget: endpoint.toString()
      };
    }

    throw new Error(`暂不支持的 MCP transport：${transport}`);
  }

  private async executeResolvedTool(input: {
    serverRef: string;
    remoteToolName: string;
    args: JsonObject;
    ctx: StructuredToolExecutionContext;
    traceLabel: string;
    toolNodeRef?: string;
  }): Promise<StructuredToolExecutionResult> {
    let serverNode: CatalogNode;
    try {
      serverNode = this.resolveCatalogNode(input.serverRef, ["mcp"]);
    } catch (error) {
      return this.buildFailureResult(
        input.ctx,
        "mcp_proxy",
        "MCP_SERVER_NOT_FOUND",
        error instanceof Error ? error.message : "找不到 MCP server 节点"
      );
    }

    const serverIntegrationFacet = asIntegrationFacet(this.deps.db.getCatalogFacet(serverNode.nodeId, "integration"));
    if (!serverIntegrationFacet || serverIntegrationFacet.sourceType !== "mcp_server") {
      return this.buildFailureResult(
        input.ctx,
        "mcp_proxy",
        "MCP_SERVER_CONFIG_INVALID",
        `节点 ${serverNode.nodeId} 缺少 mcp_server integration facet`
      );
    }

    let toolNode: CatalogNode;
    try {
      toolNode = input.toolNodeRef
        ? this.resolveCatalogNode(input.toolNodeRef, ["mcp"])
        : this.resolveMcpToolNode(serverNode.nodeId, input.remoteToolName);
    } catch (error) {
      return this.buildFailureResult(
        input.ctx,
        "mcp_proxy",
        "MCP_TOOL_NOT_FOUND",
        error instanceof Error ? error.message : "找不到 MCP tool 节点"
      );
    }

    const toolFacet = asToolFacet(this.deps.db.getCatalogFacet(toolNode.nodeId, "tool"));
    if (!toolFacet || toolFacet.toolKind !== "mcp") {
      return this.buildFailureResult(
        {
          ...input.ctx,
          toolId: toolNode.nodeId,
          toolName: toolNode.name
        },
        "mcp_proxy",
        "MCP_TOOL_CONFIG_INVALID",
        `节点 ${toolNode.nodeId} 缺少 mcp tool facet`
      );
    }

    const issues = validateArgsAgainstSchema(input.args, toolFacet.inputSchema);
    if (issues.length > 0) {
      return this.buildFailureResult(
        {
          ...input.ctx,
          toolId: toolNode.nodeId,
          toolName: toolNode.name
        },
        "mcp_proxy",
        "MCP_INPUT_SCHEMA_INVALID",
        "参数未通过 MCP tool inputSchema 校验",
        formatSchemaIssues(issues)
      );
    }

    const startedAt = nowIso();
    const startedMs = Date.now();
    const handle = await this.openMcpClient(serverNode, serverIntegrationFacet);
    try {
      const response = await handle.client.callTool({
        name: input.remoteToolName,
        arguments: input.args
      });
      const finishedAt = nowIso();
      const toolResult: ToolResult = {
        toolCallId: input.ctx.toolCallId,
        toolId: toolNode.nodeId,
        ok: response.isError !== true,
        output: {
          transport: handle.transportLabel,
          serverNodeId: serverNode.nodeId,
          toolNodeId: toolNode.nodeId,
          remoteToolName: input.remoteToolName,
          response: response as unknown as JsonValue
        },
        error:
          response.isError === true
            ? {
                code: "MCP_TOOL_RETURNED_ERROR",
                message: "远端 MCP tool 返回 isError=true",
                details: response as unknown as JsonValue
              }
            : undefined,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs
      };
      return {
        toolResult,
        toolTrace: {
          toolCallId: input.ctx.toolCallId,
          toolId: toolNode.nodeId,
          toolName: `mcp:${input.remoteToolName}`,
          executorType: "mcp_proxy",
          arguments: input.args,
          result: toolResult,
          workingDir: this.deps.workspaceRoot
        },
        sideEffects: this.buildSideEffects(
          {
            ...input.ctx,
            toolId: toolNode.nodeId,
            toolName: toolNode.name
          },
          [
            {
              type: handle.transportLabel === "stdio" ? "tool_exec" : "http_request",
              target: handle.transportTarget,
              summary: `连接 MCP server（${handle.transportLabel}）`,
              details: {
                serverNodeId: serverNode.nodeId,
                traceLabel: input.traceLabel
              } as unknown as JsonValue
            },
            {
              type: "tool_exec",
              target: `mcp:${serverNode.nodeId}/${input.remoteToolName}`,
              summary: `执行 MCP 工具 ${input.remoteToolName}`,
              details: {
                args: input.args,
                ok: toolResult.ok,
                durationMs: toolResult.durationMs
              } as unknown as JsonValue
            }
          ]
        )
      };
    } catch (error) {
      return this.buildFailureResult(
        {
          ...input.ctx,
          toolId: toolNode.nodeId,
          toolName: toolNode.name
        },
        "mcp_proxy",
        "MCP_TOOL_CALL_FAILED",
        error instanceof Error ? error.message : "MCP 工具调用失败"
      );
    } finally {
      await handle.close();
    }
  }
}

export class SkillToolExecutor extends BaseCatalogToolExecutor {
  async executeCanonicalTool(input: {
    tool: CanonicalToolSpec;
    args: JsonObject;
    ctx: StructuredToolExecutionContext;
  }): Promise<StructuredToolExecutionResult> {
    if (input.tool.routeTarget.kind !== "skill_tool") {
      return this.buildFailureResult(input.ctx, "shell", "SKILL_ROUTE_INVALID", "canonical tool 不是 skill_tool 路由");
    }
    const nodeRef =
      typeof input.tool.sourceMeta?.nodeId === "string" ? String(input.tool.sourceMeta.nodeId) : input.tool.routeTarget.skillId;
    return this.executeResolvedTool({
      skillRef: nodeRef,
      args: input.args,
      ctx: input.ctx,
      traceLabel: `canonical:${input.tool.name}`
    });
  }

  async executeBridgeCommand(input: {
    skillRef: string;
    args: JsonObject;
    rawCommand: string;
    ctx: StructuredToolExecutionContext;
  }): Promise<StructuredToolExecutionResult> {
    return this.executeResolvedTool({
      skillRef: input.skillRef,
      args: input.args,
      ctx: input.ctx,
      traceLabel: input.rawCommand
    });
  }

  private async executeResolvedTool(input: {
    skillRef: string;
    args: JsonObject;
    ctx: StructuredToolExecutionContext;
    traceLabel: string;
  }): Promise<StructuredToolExecutionResult> {
    let skillNode: CatalogNode;
    try {
      skillNode = this.resolveCatalogNode(input.skillRef, ["skill", "tool"]);
    } catch (error) {
      return this.buildFailureResult(
        input.ctx,
        "shell",
        "SKILL_NOT_FOUND",
        error instanceof Error ? error.message : "找不到 skill 节点"
      );
    }

    const toolFacet = asToolFacet(this.deps.db.getCatalogFacet(skillNode.nodeId, "tool"));
    if (!toolFacet || toolFacet.toolKind !== "skill_tool") {
      return this.buildFailureResult(
        {
          ...input.ctx,
          toolId: skillNode.nodeId,
          toolName: skillNode.name
        },
        "shell",
        "SKILL_CONFIG_INVALID",
        `节点 ${skillNode.nodeId} 不是一个可执行 skill tool`
      );
    }

    const issues = validateArgsAgainstSchema(input.args, toolFacet.inputSchema);
    if (issues.length > 0) {
      return this.buildFailureResult(
        {
          ...input.ctx,
          toolId: skillNode.nodeId,
          toolName: skillNode.name
        },
        "shell",
        "SKILL_INPUT_SCHEMA_INVALID",
        "参数未通过 skill inputSchema 校验",
        formatSchemaIssues(issues)
      );
    }

    const executionConfig = toRecord(toolFacet.executionConfig);
    const commandPath = typeof executionConfig.command === "string" ? executionConfig.command : "";
    if (!commandPath) {
      return this.buildFailureResult(
        {
          ...input.ctx,
          toolId: skillNode.nodeId,
          toolName: skillNode.name
        },
        "shell",
        "SKILL_EXECUTION_MISSING",
        `节点 ${skillNode.nodeId} 缺少 executionConfig.command`
      );
    }

    const baseArgs = Array.isArray(executionConfig.args) ? executionConfig.args.map((item) => String(item)) : [];
    const argMode = executionConfig.argMode === "flags" ? "flags" : "args_json";
    const argsJsonFlag = typeof executionConfig.argsJsonFlag === "string" ? executionConfig.argsJsonFlag : "--args-json";
    const envVarName =
      typeof executionConfig.argsJsonEnvName === "string" ? executionConfig.argsJsonEnvName : "SIMPAGENT_SKILL_ARGS_JSON";
    const envConfig = isJsonObject(executionConfig.env)
      ? Object.fromEntries(Object.entries(executionConfig.env).map(([key, value]) => [key, String(value)]))
      : {};
    const finalEnv: Record<string, string> = {
      ...Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value ?? ""])),
      ...envConfig
    };
    const finalArgs = [...baseArgs];
    const argsJsonText = JSON.stringify(input.args);
    if (argMode === "flags") {
      for (const [key, value] of Object.entries(input.args)) {
        if (value === true) {
          finalArgs.push(`--${key}`);
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            finalArgs.push(`--${key}`, typeof item === "string" ? item : JSON.stringify(item));
          }
          continue;
        }
        finalArgs.push(`--${key}`, typeof value === "string" ? value : JSON.stringify(value));
      }
      finalEnv[envVarName] = argsJsonText;
    } else {
      finalArgs.push(argsJsonFlag, argsJsonText);
      finalEnv[envVarName] = argsJsonText;
    }

    const spawnCwd = this.resolveCommandCwd(
      typeof executionConfig.cwd === "string" ? executionConfig.cwd : undefined,
      input.ctx.workspaceRoot
    );
    const startedAt = nowIso();
    const startedMs = Date.now();

    try {
      const output = await this.spawnProcess({
        command: commandPath,
        args: finalArgs,
        cwd: spawnCwd,
        env: finalEnv,
        timeoutMs: Number(toolFacet.permissionPolicy?.timeoutMs ?? 15_000)
      });
      const finishedAt = nowIso();
      const toolResult: ToolResult = {
        toolCallId: input.ctx.toolCallId,
        toolId: skillNode.nodeId,
        ok: output.exitCode === 0,
        output: {
          stdout: output.stdout,
          stderr: output.stderr,
          exitCode: output.exitCode,
          parsedStdout: output.parsedStdout,
          cwd: spawnCwd
        } as JsonValue,
        error:
          output.exitCode === 0
            ? undefined
            : {
                code: "SKILL_COMMAND_FAILED",
                message: `skill 命令退出码为 ${output.exitCode}`,
                details: {
                  stdout: truncateText(output.stdout),
                  stderr: truncateText(output.stderr)
                }
              },
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs
      };
      return {
        toolResult,
        toolTrace: {
          toolCallId: input.ctx.toolCallId,
          toolId: skillNode.nodeId,
          toolName: `skill:${skillNode.name}`,
          executorType: "shell",
          arguments: input.args,
          result: toolResult,
          workingDir: spawnCwd,
          stdoutPreview: truncateText(output.stdout, 400),
          stderrPreview: truncateText(output.stderr, 400)
        },
        sideEffects: this.buildSideEffects(
          {
            ...input.ctx,
            toolId: skillNode.nodeId,
            toolName: skillNode.name
          },
          [
            {
              type: "tool_exec",
              target: `skill:${skillNode.nodeId}`,
              summary: `执行 Skill ${skillNode.name}`,
              details: {
                command: commandPath,
                args: finalArgs,
                cwd: spawnCwd,
                exitCode: output.exitCode,
                traceLabel: input.traceLabel
              } as unknown as JsonValue
            }
          ]
        )
      };
    } catch (error) {
      return this.buildFailureResult(
        {
          ...input.ctx,
          toolId: skillNode.nodeId,
          toolName: skillNode.name
        },
        "shell",
        "SKILL_EXECUTION_FAILED",
        error instanceof Error ? error.message : "skill 执行失败"
      );
    }
  }
}
