/**
 * 本文件作用：
 * - 提供内部 shell bridge，把 `shell_command` 里的 `simpagent ...` 命令解释为框架内部动作。
 * - 当前首批支持两类桥接：
 *   1) `simpagent mcp call`：连接外部 MCP server，做 schema 校验，再调用远端 tool。
 *   2) `simpagent skill call`：把本地 skill 节点映射成受控脚本执行。
 *
 * 设计原则（教学向说明）：
 * - 模型看到的是“shell 调用规范”，而不是直接接触运行时内部对象。
 * - bridge 负责把自然偏文本的 shell 输入，归一化为结构化参数，再进入真正执行层。
 * - MCP / Skill 都走同一条“命令解析 -> 参数归一化 -> 校验 -> 执行 -> 标准化输出”的链路，
 *   这样后续要扩展更多桥接域时，接口不会散掉。
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
  JsonObject,
  JsonValue,
  ToolResult,
  ToolTrace
} from "../types/index.js";
import type { AppDatabase } from "../storage/index.js";
import { McpToolExecutor, SkillToolExecutor, type StructuredToolExecutionResult } from "../core/tools/index.js";

type SupportedBridgeDomain = "mcp" | "skill";

type ParsedBridgeCommand =
  | {
      domain: "mcp";
      action: "call";
      serverRef: string;
      toolName: string;
      args: JsonObject;
      rawTokens: string[];
    }
  | {
      domain: "skill";
      action: "call";
      skillRef: string;
      args: JsonObject;
      rawTokens: string[];
    };

interface BridgeExecutionContext {
  runId: string;
  threadId: string;
  nodeId?: string;
  agentId?: string;
  toolCallId: string;
  toolId: string;
  toolName: string;
  workspaceRoot: string;
}

export interface InternalShellBridgeExecutionResult {
  handled: boolean;
  toolResult?: ToolResult;
  toolTrace?: ToolTrace;
  sideEffects?: CanonicalToolSideEffectRecord[];
}

interface InternalShellBridgeDeps {
  projectId: string;
  db: AppDatabase;
  workspaceRoot: string;
}

interface SchemaValidationIssue {
  path: string;
  message: string;
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

function parseJsonObject(input: string): JsonObject {
  const parsed = JSON.parse(input);
  if (!isJsonObject(parsed)) {
    throw new Error("args-json 必须是 JSON 对象");
  }
  return parsed;
}

function parsePrimitiveToken(rawValue: string): JsonValue {
  const trimmed = rawValue.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed) as JsonValue;
    } catch {
      return rawValue;
    }
  }
  return rawValue;
}

function shellTokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) {
    throw new Error("命令中存在未闭合的引号");
  }
  if (escaping) {
    current += "\\";
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseOptionTokens(tokens: string[]): { options: Map<string, string | boolean>; rest: string[] } {
  const options = new Map<string, string | boolean>();
  const rest: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      rest.push(token);
      continue;
    }
    const withoutPrefix = token.slice(2);
    if (!withoutPrefix) continue;
    if (withoutPrefix.includes("=")) {
      const [rawKey, ...valueParts] = withoutPrefix.split("=");
      options.set(rawKey, valueParts.join("="));
      continue;
    }
    const next = tokens[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(withoutPrefix, next);
      index += 1;
      continue;
    }
    options.set(withoutPrefix, true);
  }
  return { options, rest };
}

function normalizeArgsFromOptions(
  options: Map<string, string | boolean>,
  reservedKeys: string[]
): JsonObject {
  const args: JsonObject = {};
  for (const [key, value] of options.entries()) {
    if (reservedKeys.includes(key)) continue;
    if (typeof value === "boolean") {
      args[key] = value;
      continue;
    }
    args[key] = parsePrimitiveToken(value);
  }
  return args;
}

function parseBridgeCommand(command: string): ParsedBridgeCommand | null {
  const tokens = shellTokenize(command);
  if (tokens.length < 3) return null;
  if (tokens[0] !== "simpagent") return null;
  const domain = tokens[1] as SupportedBridgeDomain;
  const action = tokens[2];
  if (domain !== "mcp" && domain !== "skill") return null;
  if (action !== "call") {
    throw new Error(`暂不支持的 bridge 动作：${domain} ${action}`);
  }
  const { options, rest } = parseOptionTokens(tokens.slice(3));
  if (rest.length > 0) {
    throw new Error(`存在无法识别的位置参数：${rest.join(" ")}`);
  }

  if (domain === "mcp") {
    const serverRef = String(options.get("server") ?? "").trim();
    const toolName = String(options.get("tool") ?? "").trim();
    if (!serverRef) throw new Error("MCP bridge 缺少 --server");
    if (!toolName) throw new Error("MCP bridge 缺少 --tool");
    const argsJson = options.get("args-json");
    const args =
      typeof argsJson === "string"
        ? parseJsonObject(argsJson)
        : normalizeArgsFromOptions(options, ["server", "tool", "args-json"]);
    return {
      domain,
      action: "call",
      serverRef,
      toolName,
      args,
      rawTokens: tokens
    };
  }

  const skillRef = String(options.get("skill") ?? "").trim();
  if (!skillRef) throw new Error("Skill bridge 缺少 --skill");
  const argsJson = options.get("args-json");
  const args =
    typeof argsJson === "string"
      ? parseJsonObject(argsJson)
      : normalizeArgsFromOptions(options, ["skill", "args-json"]);
  return {
    domain,
    action: "call",
    skillRef,
    args,
    rawTokens: tokens
  };
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

interface McpClientHandle {
  client: Client;
  close: () => Promise<void>;
  transportLabel: string;
  transportTarget: string;
}

export class InternalShellBridge {
  private readonly mcpToolExecutor: McpToolExecutor;
  private readonly skillToolExecutor: SkillToolExecutor;

  constructor(private readonly deps: InternalShellBridgeDeps) {
    this.mcpToolExecutor = new McpToolExecutor(deps);
    this.skillToolExecutor = new SkillToolExecutor(deps);
  }

  async tryExecute(command: string, ctx: BridgeExecutionContext): Promise<InternalShellBridgeExecutionResult | null> {
    let parsed: ParsedBridgeCommand | null;
    try {
      parsed = parseBridgeCommand(command);
    } catch (error) {
      return this.buildFailureResult(
        ctx,
        "shell_command",
        "shell",
        command,
        "BRIDGE_COMMAND_INVALID",
        error instanceof Error ? error.message : "bridge 命令解析失败"
      );
    }
    if (!parsed) return null;
    try {
      if (parsed.domain === "mcp") {
        return await this.executeMcpTool(parsed, ctx, command);
      }
      return await this.executeSkillTool(parsed, ctx, command);
    } catch (error) {
      return this.buildFailureResult(
        ctx,
        ctx.toolId,
        parsed.domain === "mcp" ? "mcp_proxy" : "shell",
        command,
        parsed.domain === "mcp" ? "MCP_BRIDGE_FAILED" : "SKILL_BRIDGE_FAILED",
        error instanceof Error ? error.message : "内部 bridge 执行失败"
      );
    }
  }

  async syncMcpServer(serverRef: string): Promise<{ serverNode: CatalogNode; createdToolNodeIds: string[] }> {
    const serverNode = this.resolveCatalogNode(serverRef, ["mcp"]);
    const integrationFacet = asIntegrationFacet(this.deps.db.getCatalogFacet(serverNode.nodeId, "integration"));
    if (!integrationFacet || integrationFacet.sourceType !== "mcp_server") {
      throw new Error(`节点 ${serverNode.nodeId} 缺少 mcp_server integration facet`);
    }

    const handle = await this.openMcpClient(serverNode, integrationFacet);
    try {
      const listed = await handle.client.listTools();
      const createdToolNodeIds: string[] = [];
      for (const tool of listed.tools) {
        const safeName = String(tool.name).replace(/[^\w.-]+/g, "_");
        const nodeId = `catalog.mcp.${serverNode.nodeId}.${safeName}`;
        const title = typeof tool.title === "string" ? tool.title : tool.name;
        this.deps.db.saveCatalogNode({
          nodeId,
          projectId: this.deps.projectId,
          parentNodeId: serverNode.nodeId,
          nodeClass: "item",
          name: `${serverNode.name}.${String(tool.name)}`,
          title,
          summaryText: tool.description ?? title,
          contentText: tool.description ?? title,
          contentFormat: "markdown",
          primaryKind: "mcp",
          visibility: "visible",
          exposeMode: "summary_first",
          enabled: true,
          sortOrder: 0,
          metadata: {
            serverNodeId: serverNode.nodeId,
            toolName: String(tool.name)
          },
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
        this.deps.db.saveCatalogFacet({
          facetId: `facet.tool.${nodeId}`,
          nodeId,
          facetType: "tool",
          payload: {
            toolKind: "mcp",
            route: {
              kind: "mcp",
              serverNodeId: serverNode.nodeId,
              toolName: String(tool.name)
            },
            executorType: "mcp_proxy",
            inputSchema: (tool.inputSchema ?? undefined) as JsonObject | undefined,
            outputSchema: (tool.outputSchema ?? undefined) as JsonObject | undefined,
            exposurePolicy: {
              preferredAdapter: "chat_function",
              fallbackAdapters: ["structured_output_tool_call", "prompt_protocol_fallback"],
              exposureLevel: "description",
              exposeByDefault: true,
              catalogPath: ["catalog", "mcp"]
            },
            permissionPolicy: {
              permissionProfileId: "perm.readonly",
              shellPermissionLevel: "readonly",
              timeoutMs: 15_000
            },
            executionConfig: {
              serverNodeId: serverNode.nodeId,
              toolName: String(tool.name)
            }
          },
          updatedAt: nowIso()
        });
        this.deps.db.saveCatalogFacet({
          facetId: `facet.integration.${nodeId}`,
          nodeId,
          facetType: "integration",
          payload: {
            sourceType: "mcp_tool",
            transport: integrationFacet.transport,
            serverName: integrationFacet.serverName,
            originalName: String(tool.name),
            originalSchema: (tool.inputSchema ?? undefined) as JsonObject | undefined,
            clientConfig: integrationFacet.clientConfig
          },
          updatedAt: nowIso()
        });
        createdToolNodeIds.push(nodeId);
      }
      return { serverNode, createdToolNodeIds };
    } finally {
      await handle.close();
    }
  }

  private async executeMcpTool(
    command: Extract<ParsedBridgeCommand, { domain: "mcp" }>,
    ctx: BridgeExecutionContext,
    rawCommand: string
  ): Promise<InternalShellBridgeExecutionResult> {
    const executed = await this.mcpToolExecutor.executeBridgeCommand({
      serverRef: command.serverRef,
      toolName: command.toolName,
      args: command.args,
      rawCommand,
      ctx
    });
    return this.asBridgeResult(executed);
  }

  private async executeSkillTool(
    command: Extract<ParsedBridgeCommand, { domain: "skill" }>,
    ctx: BridgeExecutionContext,
    rawCommand: string
  ): Promise<InternalShellBridgeExecutionResult> {
    const executed = await this.skillToolExecutor.executeBridgeCommand({
      skillRef: command.skillRef,
      args: command.args,
      rawCommand,
      ctx
    });
    return this.asBridgeResult(executed);
  }

  private asBridgeResult(executed: StructuredToolExecutionResult): InternalShellBridgeExecutionResult {
    return {
      handled: true,
      toolResult: executed.toolResult,
      toolTrace: executed.toolTrace,
      sideEffects: executed.sideEffects
    };
  }

  private resolveCatalogNode(nodeRef: string, expectedKinds: Array<CatalogNode["primaryKind"]>): CatalogNode {
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
      return executionConfig.serverNodeId === serverNodeId && this.resolveRemoteToolName(node, toolFacet) === toolName;
    });
    if (!exactNode) {
      throw new Error(`找不到 MCP tool 节点：server=${serverNodeId}, tool=${toolName}`);
    }
    return exactNode;
  }

  private resolveRemoteToolName(toolNode: CatalogNode, toolFacet: CatalogToolFacetPayload): string {
    const executionConfig = toRecord(toolFacet.executionConfig);
    if (typeof executionConfig.toolName === "string" && executionConfig.toolName.trim()) {
      return executionConfig.toolName.trim();
    }
    const integrationFacet = asIntegrationFacet(this.deps.db.getCatalogFacet(toolNode.nodeId, "integration"));
    if (integrationFacet?.originalName?.trim()) return integrationFacet.originalName.trim();
    return toolNode.name;
  }

  private async openMcpClient(
    serverNode: CatalogNode,
    integrationFacet: CatalogIntegrationFacetPayload
  ): Promise<McpClientHandle> {
    const client = new Client({ name: "simpagent-shell-bridge", version: "0.1.0" });
    const clientConfig = toRecord(integrationFacet.clientConfig);
    const transport = integrationFacet.transport ?? "stdio";

    if (transport === "stdio") {
      const command = typeof clientConfig.command === "string" ? clientConfig.command : "";
      if (!command) throw new Error(`MCP server ${serverNode.nodeId} 缺少 stdio command`);
      const args = Array.isArray(clientConfig.args) ? clientConfig.args.map((item) => String(item)) : [];
      const env = isJsonObject(clientConfig.env)
        ? Object.fromEntries(Object.entries(clientConfig.env).map(([key, value]) => [key, String(value)]))
        : undefined;
      const cwd = typeof clientConfig.cwd === "string" ? this.resolveCommandCwd(clientConfig.cwd, this.deps.workspaceRoot) : undefined;
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
            // 某些 server 可能不支持 DELETE 终止；这里忽略即可。
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

  private normalizeHeaders(value: unknown): HeadersInit | undefined {
    if (!isJsonObject(value)) return undefined;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
  }

  private resolveCommandCwd(rawCwd: string | undefined, workspaceRoot: string): string {
    if (!rawCwd) return workspaceRoot;
    return path.isAbsolute(rawCwd) ? rawCwd : path.resolve(workspaceRoot, rawCwd);
  }

  private async spawnProcess(input: {
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
        if (trimmed && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
          try {
            parsedStdout = JSON.parse(trimmed) as JsonValue;
          } catch {
            parsedStdout = undefined;
          }
        }
        resolve({
          stdout,
          stderr,
          exitCode: typeof code === "number" ? code : -1,
          parsedStdout
        });
      });
    });
  }

  private buildBridgeSideEffects(
    ctx: BridgeExecutionContext,
    effects: Array<{
      type: CanonicalToolSideEffectRecord["type"];
      target?: string;
      summary: string;
      details?: JsonValue;
    }>
  ): CanonicalToolSideEffectRecord[] {
    return effects.map((effect) => ({
      sideEffectId: newId("sfx"),
      runId: ctx.runId,
      threadId: ctx.threadId,
      nodeId: ctx.nodeId,
      agentId: ctx.agentId,
      type: effect.type,
      target: effect.target,
      summary: effect.summary,
      details: effect.details,
      timestamp: nowIso()
    }));
  }

  private buildFailureResult(
    ctx: BridgeExecutionContext,
    toolId: string,
    executorType: ToolTrace["executorType"],
    rawCommand: string,
    code: string,
    message: string,
    details?: JsonValue
  ): InternalShellBridgeExecutionResult {
    const startedAt = nowIso();
    const toolResult: ToolResult = {
      toolCallId: ctx.toolCallId,
      toolId,
      ok: false,
      error: { code, message, details },
      startedAt,
      finishedAt: startedAt,
      durationMs: 0
    };
    return {
      handled: true,
      toolResult,
      toolTrace: {
        toolCallId: ctx.toolCallId,
        toolId,
        toolName: ctx.toolName,
        executorType,
        arguments: { command: rawCommand },
        result: toolResult,
        workingDir: ctx.workspaceRoot
      },
      sideEffects: this.buildBridgeSideEffects(ctx, [
        {
          type: "tool_exec",
          target: toolId,
          summary: `bridge 执行失败：${message}`,
          details: {
            code,
            message,
            extra: details ?? null
          }
        }
      ])
    };
  }
}
