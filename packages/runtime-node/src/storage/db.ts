/**
 * 本文件作用：
 * - 提供 SQLite 访问封装（Node.js 内置 `node:sqlite`）。
 * - 封装常用的配置版本化、Run、Trace、PromptCompile、ToolCall 的读写方法。
 *
 * 教学说明：
 * - 这里有意保持“薄封装”，让 SQL 结构清晰可见，便于初学者理解与排错。
 * - 复杂 ORM 会降低首版调试透明度，因此暂不引入。
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  AgentSpec,
  BuiltinToolConfig,
  CatalogNode,
  CatalogNodeFacet,
  CatalogRelation,
  CanonicalToolSideEffectRecord,
  ForkRunResponse,
  JsonValue,
  PlanState,
  PromptBlock,
  PromptTrace,
  RunStatus,
  StateDiffTrace,
  ToolSpec,
  ToolExposurePlan,
  TraceEvent,
  UnifiedMessage,
  UserInputRequestState,
  WorkflowSpec
} from "../types/index.js";
import {
  mapCatalogPromptNodeToPromptBlock,
  projectCatalogNodeToContextPromptBlocks
} from "../catalog/index.js";
import { SCHEMA_SQL } from "./schema.js";

function nowIso(): string {
  return new Date().toISOString();
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function fromJson<T>(value: unknown): T {
  if (typeof value !== "string") {
    throw new Error("数据库 JSON 字段不是字符串，数据可能已损坏");
  }
  return JSON.parse(value) as T;
}

/**
 * 版本化配置实体的类型标签。
 * 用于复用同一套 upsertVersion 逻辑。
 */
type VersionedEntityKind = "agent" | "prompt_block" | "workflow" | "tool";

interface RunRowSnapshot {
  run_id: string;
  thread_id: string;
  workflow_id: string;
  workflow_version: number;
  status: RunStatus;
  current_node_id: string | null;
  snapshot_version_refs_json: string;
  provider_config_json: string;
  input_json: string;
  created_at: string;
  updated_at: string;
  parent_run_id: string | null;
  parent_checkpoint_id: string | null;
}

/**
 * 调试台系统设置（框架层通用，不绑定某个具体 App）。
 */
export interface SystemConfig {
  defaultModelRoute: {
    vendor: string;
    apiMode: "responses" | "chat_completions";
    model: string;
    baseURL?: string;
    toolProtocolProfile?: string;
    temperature?: number;
  };
  contextWindow: {
    conversationRounds: number;
  };
  tracePolicy: {
    wsLogLimit: number;
    traceEventLimit: number;
    stateDiffLimit: number;
    sideEffectLimit: number;
  };
}

/**
 * 接口层使用的“每轮工具暴露计划”行视图。
 * 说明：
 * - 保留 plan 原文，方便前端在详情抽屉内直接查看。
 */
export interface ToolExposurePlanRow {
  planId: string;
  runId: string;
  threadId: string;
  nodeId?: string;
  agentId?: string;
  adapterKind: string;
  createdAt: string;
  plan: ToolExposurePlan;
}

/**
 * 接口层使用的 request_user_input 行视图。
 */
export interface UserInputRequestRow {
  requestId: string;
  runId: string;
  threadId: string;
  nodeId?: string;
  agentId?: string;
  status: string;
  payload: JsonValue;
  answer?: JsonValue;
  requestedAt: string;
  answeredAt?: string;
}

function defaultSystemConfig(): SystemConfig {
  return {
    defaultModelRoute: {
      vendor: "mock",
      apiMode: "responses",
      model: "gpt-5-mini",
      toolProtocolProfile: "auto",
      temperature: 0.4
    },
    contextWindow: {
      conversationRounds: 5
    },
    tracePolicy: {
      wsLogLimit: 200,
      traceEventLimit: 2000,
      stateDiffLimit: 200,
      sideEffectLimit: 200
    }
  };
}

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(dbFilePath: string) {
    // 先确保数据库文件所在目录存在，否则 SQLite 会直接报 unable to open database file。
    mkdirSync(path.dirname(dbFilePath), { recursive: true });
    this.db = new DatabaseSync(dbFilePath);
    // 启动时立即建表，避免运行到中间步骤才报表不存在。
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * 生成简单主键。
   * 说明：
   * - 使用 randomUUID，便于多线程/多请求下避免冲突。
   */
  newId(prefix: string): string {
    return `${prefix}_${randomUUID().replace(/-/g, "")}`;
  }

  /**
   * 写入或发布一个“版本化配置对象”。
   * 返回新版本号。
   */
  saveVersionedConfig<T extends { id: string; enabled?: boolean }>(
    kind: VersionedEntityKind,
    payload: T
  ): number {
    const now = nowIso();
    const map = {
      agent: {
        table: "agents",
        versionTable: "agent_versions",
        idCol: "agent_id",
        payloadIdField: "id"
      },
      prompt_block: {
        table: "prompt_blocks",
        versionTable: "prompt_block_versions",
        idCol: "block_id",
        payloadIdField: "id"
      },
      workflow: {
        table: "workflows",
        versionTable: "workflow_versions",
        idCol: "workflow_id",
        payloadIdField: "id"
      },
      tool: {
        table: "tools",
        versionTable: "tool_versions",
        idCol: "tool_id",
        payloadIdField: "id"
      }
    } as const;

    const conf = map[kind];
    const rootRow = this.db
      .prepare(`SELECT current_version FROM ${conf.table} WHERE id = ?`)
      .get(payload.id) as { current_version?: number } | undefined;
    const nextVersion = (rootRow?.current_version ?? 0) + 1;

    // 将 version 字段同步写入 payload（如果对象定义包含该字段，运行时会覆盖）。
    const versionedPayload = { ...payload, version: nextVersion } as T & { version: number };

    this.db
      .prepare(
        `INSERT INTO ${conf.versionTable} (${conf.idCol}, version, payload_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(payload.id, nextVersion, toJson(versionedPayload), now);

    this.db
      .prepare(
        `INSERT INTO ${conf.table} (id, current_version, enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           current_version = excluded.current_version,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at`
      )
      .run(payload.id, nextVersion, payload.enabled === false ? 0 : 1, now);

    return nextVersion;
  }

  listAgents(): AgentSpec[] {
    const rows = this.db
      .prepare(
        `SELECT v.payload_json
         FROM agents a
         JOIN agent_versions v
           ON v.agent_id = a.id AND v.version = a.current_version
         ORDER BY a.id`
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<AgentSpec>(row.payload_json));
  }

  getAgent(agentId: string, version?: number): AgentSpec | null {
    const row = version
      ? (this.db
          .prepare(`SELECT payload_json FROM agent_versions WHERE agent_id = ? AND version = ?`)
          .get(agentId, version) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT v.payload_json
             FROM agents a
             JOIN agent_versions v
               ON v.agent_id = a.id AND v.version = a.current_version
             WHERE a.id = ?`
          )
          .get(agentId) as { payload_json: string } | undefined);
    return row ? fromJson<AgentSpec>(row.payload_json) : null;
  }

  listPromptBlocks(): PromptBlock[] {
    const rows = this.db
      .prepare(
        `SELECT v.payload_json
         FROM prompt_blocks b
         JOIN prompt_block_versions v
           ON v.block_id = b.id AND v.version = b.current_version
         ORDER BY b.id`
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<PromptBlock>(row.payload_json));
  }

  getPromptBlock(blockId: string, version?: number): PromptBlock | null {
    const row = version
      ? (this.db
          .prepare(`SELECT payload_json FROM prompt_block_versions WHERE block_id = ? AND version = ?`)
          .get(blockId, version) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT v.payload_json
             FROM prompt_blocks b
             JOIN prompt_block_versions v
               ON v.block_id = b.id AND v.version = b.current_version
             WHERE b.id = ?`
          )
          .get(blockId) as { payload_json: string } | undefined);
    return row ? fromJson<PromptBlock>(row.payload_json) : null;
  }

  /**
   * v0.3 语义别名：
   * - 持久化层统一命名为 PromptUnit；
   * - 底层沿用旧表 `prompt_blocks`，避免迁移期间破坏兼容性。
   */
  listPromptUnits(projectId = "default"): PromptBlock[] {
    const catalogUnits = this.listCatalogPromptUnits(projectId);
    const legacyUnits = this.listPromptBlocks();
    const merged = new Map<string, PromptBlock>();
    for (const unit of legacyUnits) merged.set(unit.id, unit);
    for (const unit of catalogUnits) merged.set(unit.id, unit);
    return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getPromptUnit(unitId: string, version?: number, projectId = "default"): PromptBlock | null {
    const catalogItem = this.getCatalogPromptUnit(unitId, projectId);
    if (catalogItem) return catalogItem;
    return this.getPromptBlock(unitId, version);
  }

  listWorkflows(): WorkflowSpec[] {
    const rows = this.db
      .prepare(
        `SELECT v.payload_json
         FROM workflows w
         JOIN workflow_versions v
           ON v.workflow_id = w.id AND v.version = w.current_version
         ORDER BY w.id`
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<WorkflowSpec>(row.payload_json));
  }

  getWorkflow(workflowId: string, version?: number): WorkflowSpec | null {
    const row = version
      ? (this.db
          .prepare(`SELECT payload_json FROM workflow_versions WHERE workflow_id = ? AND version = ?`)
          .get(workflowId, version) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT v.payload_json
             FROM workflows w
             JOIN workflow_versions v
               ON v.workflow_id = w.id AND v.version = w.current_version
             WHERE w.id = ?`
          )
          .get(workflowId) as { payload_json: string } | undefined);
    return row ? fromJson<WorkflowSpec>(row.payload_json) : null;
  }

  listTools(): ToolSpec[] {
    const rows = this.db
      .prepare(
        `SELECT v.payload_json
         FROM tools t
         JOIN tool_versions v
           ON v.tool_id = t.id AND v.version = t.current_version
         ORDER BY t.id`
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<ToolSpec>(row.payload_json));
  }

  getTool(toolId: string, version?: number): ToolSpec | null {
    const row = version
      ? (this.db
          .prepare(`SELECT payload_json FROM tool_versions WHERE tool_id = ? AND version = ?`)
          .get(toolId, version) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT v.payload_json
             FROM tools t
             JOIN tool_versions v
               ON v.tool_id = t.id AND v.version = t.current_version
             WHERE t.id = ?`
          )
          .get(toolId) as { payload_json: string } | undefined);
    return row ? fromJson<ToolSpec>(row.payload_json) : null;
  }

  /**
   * 读取某项目下的全部图谱节点。
   */
  listCatalogNodes(projectId = "default"): CatalogNode[] {
    const rows = this.db
      .prepare(
        `SELECT node_id, project_id, parent_node_id, node_class, name, title,
                summary_text, content_text, content_format, primary_kind,
                visibility, expose_mode, enabled, sort_order,
                tags_json, metadata_json, created_at, updated_at
         FROM catalog_nodes
         WHERE project_id = ?
         ORDER BY parent_node_id ASC, sort_order ASC, name ASC`
      )
      .all(projectId) as Array<{
      node_id: string;
      project_id: string;
      parent_node_id: string | null;
      node_class: CatalogNode["nodeClass"];
      name: string;
      title: string | null;
      summary_text: string | null;
      content_text: string | null;
      content_format: NonNullable<CatalogNode["contentFormat"]>;
      primary_kind: NonNullable<CatalogNode["primaryKind"]>;
      visibility: CatalogNode["visibility"];
      expose_mode: CatalogNode["exposeMode"];
      enabled: number;
      sort_order: number;
      tags_json: string | null;
      metadata_json: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      nodeId: row.node_id,
      projectId: row.project_id,
      parentNodeId: row.parent_node_id ?? undefined,
      nodeClass: row.node_class,
      name: row.name,
      title: row.title ?? undefined,
      summaryText: row.summary_text ?? undefined,
      contentText: row.content_text ?? undefined,
      contentFormat: row.content_format,
      primaryKind: row.primary_kind,
      visibility: row.visibility,
      exposeMode: row.expose_mode,
      enabled: row.enabled === 1,
      sortOrder: row.sort_order,
      tags: row.tags_json ? fromJson<string[]>(row.tags_json) : undefined,
      metadata: row.metadata_json ? fromJson<Record<string, JsonValue>>(row.metadata_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  getCatalogNode(nodeId: string, projectId = "default"): CatalogNode | null {
    const row = this.db
      .prepare(
        `SELECT node_id, project_id, parent_node_id, node_class, name, title,
                summary_text, content_text, content_format, primary_kind,
                visibility, expose_mode, enabled, sort_order,
                tags_json, metadata_json, created_at, updated_at
         FROM catalog_nodes
         WHERE project_id = ? AND node_id = ?`
      )
      .get(projectId, nodeId) as
      | {
          node_id: string;
          project_id: string;
          parent_node_id: string | null;
          node_class: CatalogNode["nodeClass"];
          name: string;
          title: string | null;
          summary_text: string | null;
          content_text: string | null;
          content_format: NonNullable<CatalogNode["contentFormat"]>;
          primary_kind: NonNullable<CatalogNode["primaryKind"]>;
          visibility: CatalogNode["visibility"];
          expose_mode: CatalogNode["exposeMode"];
          enabled: number;
          sort_order: number;
          tags_json: string | null;
          metadata_json: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      nodeId: row.node_id,
      projectId: row.project_id,
      parentNodeId: row.parent_node_id ?? undefined,
      nodeClass: row.node_class,
      name: row.name,
      title: row.title ?? undefined,
      summaryText: row.summary_text ?? undefined,
      contentText: row.content_text ?? undefined,
      contentFormat: row.content_format,
      primaryKind: row.primary_kind,
      visibility: row.visibility,
      exposeMode: row.expose_mode,
      enabled: row.enabled === 1,
      sortOrder: row.sort_order,
      tags: row.tags_json ? fromJson<string[]>(row.tags_json) : undefined,
      metadata: row.metadata_json ? fromJson<Record<string, JsonValue>>(row.metadata_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  saveCatalogNode(node: CatalogNode): CatalogNode {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO catalog_nodes (
          node_id, project_id, parent_node_id, node_class, name, title,
          summary_text, content_text, content_format, primary_kind,
          visibility, expose_mode, enabled, sort_order,
          tags_json, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          project_id = excluded.project_id,
          parent_node_id = excluded.parent_node_id,
          node_class = excluded.node_class,
          name = excluded.name,
          title = excluded.title,
          summary_text = excluded.summary_text,
          content_text = excluded.content_text,
          content_format = excluded.content_format,
          primary_kind = excluded.primary_kind,
          visibility = excluded.visibility,
          expose_mode = excluded.expose_mode,
          enabled = excluded.enabled,
          sort_order = excluded.sort_order,
          tags_json = excluded.tags_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`
      )
      .run(
        node.nodeId,
        node.projectId,
        node.parentNodeId ?? null,
        node.nodeClass,
        node.name,
        node.title ?? null,
        node.summaryText ?? null,
        node.contentText ?? null,
        node.contentFormat ?? "markdown",
        node.primaryKind ?? "generic",
        node.visibility,
        node.exposeMode,
        node.enabled ? 1 : 0,
        node.sortOrder,
        node.tags ? toJson(node.tags) : null,
        node.metadata ? toJson(node.metadata) : null,
        node.createdAt || now,
        now
      );
    return {
      ...node,
      updatedAt: now,
      createdAt: node.createdAt || now
    };
  }

  deleteCatalogNode(nodeId: string): void {
    this.db.prepare(`DELETE FROM catalog_node_facets WHERE node_id = ?`).run(nodeId);
    this.db.prepare(`DELETE FROM catalog_relations WHERE from_node_id = ? OR to_node_id = ?`).run(nodeId, nodeId);
    this.db.prepare(`DELETE FROM catalog_nodes WHERE node_id = ?`).run(nodeId);
  }

  listCatalogRelations(projectId = "default"): CatalogRelation[] {
    const rows = this.db
      .prepare(
        `SELECT relation_id, project_id, from_node_id, to_node_id, relation_type, weight, metadata_json, created_at, updated_at
         FROM catalog_relations
         WHERE project_id = ?
         ORDER BY from_node_id ASC, to_node_id ASC`
      )
      .all(projectId) as Array<{
      relation_id: string;
      project_id: string;
      from_node_id: string;
      to_node_id: string;
      relation_type: CatalogRelation["relationType"];
      weight: number | null;
      metadata_json: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      relationId: row.relation_id,
      projectId: row.project_id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      relationType: row.relation_type,
      weight: row.weight ?? undefined,
      metadata: row.metadata_json ? fromJson<Record<string, JsonValue>>(row.metadata_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  saveCatalogRelation(relation: CatalogRelation): CatalogRelation {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO catalog_relations (
          relation_id, project_id, from_node_id, to_node_id, relation_type, weight, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(relation_id) DO UPDATE SET
          project_id = excluded.project_id,
          from_node_id = excluded.from_node_id,
          to_node_id = excluded.to_node_id,
          relation_type = excluded.relation_type,
          weight = excluded.weight,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`
      )
      .run(
        relation.relationId,
        relation.projectId,
        relation.fromNodeId,
        relation.toNodeId,
        relation.relationType,
        relation.weight ?? null,
        relation.metadata ? toJson(relation.metadata) : null,
        relation.createdAt || now,
        now
      );
    return {
      ...relation,
      createdAt: relation.createdAt || now,
      updatedAt: now
    };
  }

  listCatalogNodeFacets(projectId = "default"): CatalogNodeFacet[] {
    const rows = this.db
      .prepare(
        `SELECT f.facet_id, f.node_id, f.facet_type, f.payload_json, f.updated_at
         FROM catalog_node_facets f
         JOIN catalog_nodes n ON n.node_id = f.node_id
         WHERE n.project_id = ?
         ORDER BY f.node_id ASC, f.facet_type ASC`
      )
      .all(projectId) as Array<{
      facet_id: string;
      node_id: string;
      facet_type: CatalogNodeFacet["facetType"];
      payload_json: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      facetId: row.facet_id,
      nodeId: row.node_id,
      facetType: row.facet_type,
      payload: fromJson<CatalogNodeFacet["payload"]>(row.payload_json),
      updatedAt: row.updated_at
    }));
  }

  listCatalogFacetsByNodeId(nodeId: string): CatalogNodeFacet[] {
    const rows = this.db
      .prepare(
        `SELECT facet_id, node_id, facet_type, payload_json, updated_at
         FROM catalog_node_facets
         WHERE node_id = ?
         ORDER BY facet_type ASC`
      )
      .all(nodeId) as Array<{
      facet_id: string;
      node_id: string;
      facet_type: CatalogNodeFacet["facetType"];
      payload_json: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      facetId: row.facet_id,
      nodeId: row.node_id,
      facetType: row.facet_type,
      payload: fromJson<CatalogNodeFacet["payload"]>(row.payload_json),
      updatedAt: row.updated_at
    }));
  }

  getCatalogFacet(nodeId: string, facetType: CatalogNodeFacet["facetType"]): CatalogNodeFacet | null {
    const row = this.db
      .prepare(
        `SELECT facet_id, node_id, facet_type, payload_json, updated_at
         FROM catalog_node_facets
         WHERE node_id = ? AND facet_type = ?`
      )
      .get(nodeId, facetType) as
      | {
          facet_id: string;
          node_id: string;
          facet_type: CatalogNodeFacet["facetType"];
          payload_json: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      facetId: row.facet_id,
      nodeId: row.node_id,
      facetType: row.facet_type,
      payload: fromJson<CatalogNodeFacet["payload"]>(row.payload_json),
      updatedAt: row.updated_at
    };
  }

  saveCatalogFacet(facet: CatalogNodeFacet): CatalogNodeFacet {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO catalog_node_facets (facet_id, node_id, facet_type, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(node_id, facet_type) DO UPDATE SET
           facet_id = excluded.facet_id,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(facet.facetId, facet.nodeId, facet.facetType, toJson(facet.payload), now);
    return {
      ...facet,
      updatedAt: now
    };
  }

  deleteCatalogFacet(nodeId: string, facetType: CatalogNodeFacet["facetType"]): void {
    this.db.prepare(`DELETE FROM catalog_node_facets WHERE node_id = ? AND facet_type = ?`).run(nodeId, facetType);
  }

  /**
   * 读取 catalog 中显式 PromptUnit 节点，并映射为现有 PromptBlock。
   */
  listCatalogPromptUnits(projectId = "default"): PromptBlock[] {
    const nodes = this.listCatalogNodes(projectId);
    const facets = this.listCatalogNodeFacets(projectId);
    const facetsByNode = new Map<string, CatalogNodeFacet[]>();
    for (const facet of facets) {
      const list = facetsByNode.get(facet.nodeId) ?? [];
      list.push(facet);
      facetsByNode.set(facet.nodeId, list);
    }
    return nodes
      .map((node) => mapCatalogPromptNodeToPromptBlock(node, facetsByNode.get(node.nodeId) ?? []))
      .filter((item): item is PromptBlock => Boolean(item));
  }

  getCatalogPromptUnit(nodeId: string, projectId = "default"): PromptBlock | null {
    const node = this.getCatalogNode(nodeId, projectId);
    if (!node) return null;
    return mapCatalogPromptNodeToPromptBlock(node, this.listCatalogFacetsByNodeId(nodeId));
  }

  /**
   * 读取 catalog 中可直接注入上下文的说明性 PromptBlock。
   * 说明：
   * - 这些块不依赖 Agent 显式绑定；
   * - 主要用于工具目录、世界书、技能说明、MCP 工具说明。
   */
  listCatalogContextPromptUnits(projectId = "default"): PromptBlock[] {
    const nodes = this.listCatalogNodes(projectId);
    const facets = this.listCatalogNodeFacets(projectId);
    const facetsByNode = new Map<string, CatalogNodeFacet[]>();
    for (const facet of facets) {
      const list = facetsByNode.get(facet.nodeId) ?? [];
      list.push(facet);
      facetsByNode.set(facet.nodeId, list);
    }
    const results: PromptBlock[] = [];
    for (const node of nodes) {
      for (const item of projectCatalogNodeToContextPromptBlocks(node, facetsByNode.get(node.nodeId) ?? [])) {
        results.push(item);
      }
    }
    return results;
  }

  /**
   * 读取某项目下所有内置工具运行配置。
   */
  listBuiltinToolConfigs(projectId = "default"): BuiltinToolConfig[] {
    const rows = this.db
      .prepare(
        `SELECT payload_json
         FROM builtin_tool_configs
         WHERE project_id = ?
         ORDER BY name ASC`
      )
      .all(projectId) as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<BuiltinToolConfig>(row.payload_json));
  }

  getBuiltinToolConfig(name: string, projectId = "default"): BuiltinToolConfig | null {
    const row = this.db
      .prepare(
        `SELECT payload_json
         FROM builtin_tool_configs
         WHERE project_id = ? AND name = ?`
      )
      .get(projectId, name) as { payload_json: string } | undefined;
    return row ? fromJson<BuiltinToolConfig>(row.payload_json) : null;
  }

  saveBuiltinToolConfig(config: BuiltinToolConfig, projectId = "default"): BuiltinToolConfig {
    this.db
      .prepare(
        `INSERT INTO builtin_tool_configs (project_id, name, payload_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, name) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(projectId, config.name, toJson(config), nowIso());
    return { ...config };
  }

  getSystemConfig(projectId = "default"): SystemConfig {
    const row = this.db
      .prepare(`SELECT payload_json FROM system_configs WHERE project_id = ?`)
      .get(projectId) as { payload_json: string } | undefined;
    if (!row) return defaultSystemConfig();
    const parsed = fromJson<Partial<SystemConfig>>(row.payload_json);
    return {
      ...defaultSystemConfig(),
      ...parsed,
      defaultModelRoute: {
        ...defaultSystemConfig().defaultModelRoute,
        ...(parsed.defaultModelRoute ?? {})
      },
      contextWindow: {
        ...defaultSystemConfig().contextWindow,
        ...(parsed.contextWindow ?? {})
      },
      tracePolicy: {
        ...defaultSystemConfig().tracePolicy,
        ...(parsed.tracePolicy ?? {})
      }
    };
  }

  upsertSystemConfig(nextConfig: Partial<SystemConfig>, projectId = "default"): SystemConfig {
    const current = this.getSystemConfig(projectId);
    const merged: SystemConfig = {
      ...current,
      ...nextConfig,
      defaultModelRoute: {
        ...current.defaultModelRoute,
        ...(nextConfig.defaultModelRoute ?? {})
      },
      contextWindow: {
        ...current.contextWindow,
        ...(nextConfig.contextWindow ?? {})
      },
      tracePolicy: {
        ...current.tracePolicy,
        ...(nextConfig.tracePolicy ?? {})
      }
    };
    this.db
      .prepare(
        `INSERT INTO system_configs (project_id, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(projectId, toJson(merged), nowIso());
    return merged;
  }

  /**
   * 写入 run 摘要。
   * 注意：
   * - snapshot_version_refs_json 会记录创建 run 时冻结的配置版本，避免热更新污染旧 run。
   */
  upsertRunSummary(input: {
    runId: string;
    threadId: string;
    workflowId: string;
    workflowVersion: number;
    status: RunStatus;
    currentNodeId?: string | null;
    snapshotVersionRefs: JsonValue;
    providerConfig: JsonValue;
    inputJson: JsonValue;
    parentRunId?: string;
    parentCheckpointId?: string;
  }): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO runs (
          run_id, thread_id, workflow_id, workflow_version, status, current_node_id,
          snapshot_version_refs_json, provider_config_json, input_json,
          created_at, updated_at, parent_run_id, parent_checkpoint_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          status = excluded.status,
          current_node_id = excluded.current_node_id,
          snapshot_version_refs_json = excluded.snapshot_version_refs_json,
          provider_config_json = excluded.provider_config_json,
          input_json = excluded.input_json,
          updated_at = excluded.updated_at,
          parent_run_id = COALESCE(excluded.parent_run_id, runs.parent_run_id),
          parent_checkpoint_id = COALESCE(excluded.parent_checkpoint_id, runs.parent_checkpoint_id)`
      )
      .run(
        input.runId,
        input.threadId,
        input.workflowId,
        input.workflowVersion,
        input.status,
        input.currentNodeId ?? null,
        toJson(input.snapshotVersionRefs),
        toJson(input.providerConfig),
        toJson(input.inputJson),
        now,
        now,
        input.parentRunId ?? null,
        input.parentCheckpointId ?? null
      );

    this.db
      .prepare(
        `INSERT INTO run_threads (thread_id, latest_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           latest_run_id = excluded.latest_run_id,
           updated_at = excluded.updated_at`
      )
      .run(input.threadId, input.runId, now, now);
  }

  updateRunStatus(runId: string, status: RunStatus, currentNodeId?: string | null): void {
    this.db
      .prepare(`UPDATE runs SET status = ?, current_node_id = ?, updated_at = ? WHERE run_id = ?`)
      .run(status, currentNodeId ?? null, nowIso(), runId);
  }

  getRunSummary(runId: string): (RunRowSnapshot & { snapshotVersionRefs: JsonValue }) | null {
    const row = this.db
      .prepare(`SELECT * FROM runs WHERE run_id = ?`)
      .get(runId) as RunRowSnapshot | undefined;
    if (!row) return null;
    return {
      ...row,
      snapshotVersionRefs: fromJson<JsonValue>(row.snapshot_version_refs_json)
    };
  }

  /**
   * 为一个 run 分配下一个 trace seq（单调递增）。
   * 说明：
   * - 直接查 max(seq) 实现最简单，首版性能可接受。
   */
  nextTraceSeq(runId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(seq) AS max_seq FROM trace_events WHERE run_id = ?`)
      .get(runId) as { max_seq: number | null };
    return (row.max_seq ?? 0) + 1;
  }

  insertTraceEvent(event: TraceEvent): void {
    this.db
      .prepare(
        `INSERT INTO trace_events (
          run_id, thread_id, seq, event_id, type, node_id, agent_id, summary, payload_json, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.runId,
        event.threadId,
        event.seq,
        event.eventId,
        event.type,
        event.nodeId ?? null,
        event.agentId ?? null,
        event.summary,
        event.payload ? toJson(event.payload) : null,
        event.timestamp
      );
  }

  listTraceEvents(runId: string, afterSeq = 0, limit = 200): TraceEvent[] {
    const rows = this.db
      .prepare(
        `SELECT run_id, thread_id, seq, event_id, type, node_id, agent_id, summary, payload_json, timestamp
         FROM trace_events
         WHERE run_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`
      )
      .all(runId, afterSeq, limit) as Array<{
      run_id: string;
      thread_id: string;
      seq: number;
      event_id: string;
      type: string;
      node_id: string | null;
      agent_id: string | null;
      summary: string;
      payload_json: string | null;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      runId: row.run_id,
      threadId: row.thread_id,
      seq: row.seq,
      eventId: row.event_id,
      type: row.type as TraceEvent["type"],
      nodeId: row.node_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      summary: row.summary,
      payload: row.payload_json ? fromJson<JsonValue>(row.payload_json) : undefined,
      timestamp: row.timestamp
    }));
  }

  insertPromptCompile(input: {
    compileId: string;
    runId: string;
    threadId: string;
    agentId: string;
    providerApiType: string;
    promptTrace: PromptTrace;
    finalMessages: UnifiedMessage[];
  }): void {
    this.db
      .prepare(
        `INSERT INTO prompt_compiles (
          compile_id, run_id, thread_id, agent_id, provider_api_type,
          prompt_trace_json, final_messages_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.compileId,
        input.runId,
        input.threadId,
        input.agentId,
        input.providerApiType,
        toJson(input.promptTrace),
        toJson(input.finalMessages),
        nowIso()
      );
  }

  getPromptCompile(compileId: string): {
    compileId: string;
    promptTrace: PromptTrace;
    finalMessages: UnifiedMessage[];
  } | null {
    const row = this.db
      .prepare(`SELECT * FROM prompt_compiles WHERE compile_id = ?`)
      .get(compileId) as
      | {
          compile_id: string;
          prompt_trace_json: string;
          final_messages_json: string;
        }
      | undefined;
    if (!row) return null;
    return {
      compileId: row.compile_id,
      promptTrace: fromJson<PromptTrace>(row.prompt_trace_json),
      finalMessages: fromJson<UnifiedMessage[]>(row.final_messages_json)
    };
  }

  insertToolCallTrace(input: {
    toolCallId: string;
    runId: string;
    threadId: string;
    toolId: string;
    toolName: string;
    traceJson: JsonValue;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls (tool_call_id, run_id, thread_id, tool_id, tool_name, trace_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.toolCallId,
        input.runId,
        input.threadId,
        input.toolId,
        input.toolName,
        toJson(input.traceJson),
        nowIso()
      );
  }

  /**
   * v0.2：写入节点级状态差异。
   * 说明：
   * - 该表用于调试器快速展示“本节点改了什么”；
   * - 不替代 LangGraph checkpoint。
   */
  insertStateDiff(input: StateDiffTrace): void {
    this.db
      .prepare(
        `INSERT INTO state_diffs (
          diff_id, run_id, thread_id, node_id, agent_id,
          before_summary_json, after_summary_json, diff_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.diffId,
        input.runId,
        input.threadId,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.beforeSummary ? toJson(input.beforeSummary) : null,
        input.afterSummary ? toJson(input.afterSummary) : null,
        toJson(input.diff),
        input.createdAt
      );
  }

  listStateDiffs(runId: string, limit = 200): StateDiffTrace[] {
    const rows = this.db
      .prepare(
        `SELECT diff_id, run_id, thread_id, node_id, agent_id,
                before_summary_json, after_summary_json, diff_json, created_at
         FROM state_diffs
         WHERE run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{
      diff_id: string;
      run_id: string;
      thread_id: string;
      node_id: string | null;
      agent_id: string | null;
      before_summary_json: string | null;
      after_summary_json: string | null;
      diff_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      diffId: row.diff_id,
      runId: row.run_id,
      threadId: row.thread_id,
      nodeId: row.node_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      beforeSummary: row.before_summary_json ? fromJson<JsonValue>(row.before_summary_json) : undefined,
      afterSummary: row.after_summary_json ? fromJson<JsonValue>(row.after_summary_json) : undefined,
      diff: fromJson<JsonValue>(row.diff_json),
      createdAt: row.created_at
    }));
  }

  /**
   * v0.2：统一副作用记录。
   */
  insertSideEffect(input: CanonicalToolSideEffectRecord): void {
    this.db
      .prepare(
        `INSERT INTO side_effects (
          side_effect_id, run_id, thread_id, node_id, agent_id,
          effect_type, target, summary, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.sideEffectId,
        input.runId,
        input.threadId,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.type,
        input.target ?? null,
        input.summary,
        input.details ? toJson(input.details) : null,
        input.timestamp
      );
  }

  listSideEffects(runId: string, limit = 200): CanonicalToolSideEffectRecord[] {
    const rows = this.db
      .prepare(
        `SELECT side_effect_id, run_id, thread_id, node_id, agent_id,
                effect_type, target, summary, details_json, created_at
         FROM side_effects
         WHERE run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{
      side_effect_id: string;
      run_id: string;
      thread_id: string;
      node_id: string | null;
      agent_id: string | null;
      effect_type: string;
      target: string | null;
      summary: string;
      details_json: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      sideEffectId: row.side_effect_id,
      runId: row.run_id,
      threadId: row.thread_id,
      nodeId: row.node_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      type: row.effect_type as CanonicalToolSideEffectRecord["type"],
      target: row.target ?? undefined,
      summary: row.summary,
      details: row.details_json ? fromJson<JsonValue>(row.details_json) : undefined,
      timestamp: row.created_at
    }));
  }

  /**
   * v0.2：记录工具暴露计划（供调试器查看每轮工具是如何暴露给模型的）。
   */
  insertToolExposurePlan(input: {
    runId: string;
    threadId: string;
    nodeId?: string;
    agentId?: string;
    plan: ToolExposurePlan;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tool_exposure_plans (
          plan_id, run_id, thread_id, node_id, agent_id, adapter_kind, plan_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.plan.planId,
        input.runId,
        input.threadId,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.plan.adapterKind,
        toJson(input.plan),
        nowIso()
      );
  }

  listToolExposurePlans(runId: string, limit = 100): ToolExposurePlan[] {
    const rows = this.db
      .prepare(
        `SELECT plan_json
         FROM tool_exposure_plans
         WHERE run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{ plan_json: string }>;
    return rows.map((row) => fromJson<ToolExposurePlan>(row.plan_json));
  }

  listToolExposurePlanRows(runId: string, limit = 100): ToolExposurePlanRow[] {
    const rows = this.db
      .prepare(
        `SELECT plan_id, run_id, thread_id, node_id, agent_id, adapter_kind, plan_json, created_at
         FROM tool_exposure_plans
         WHERE run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{
      plan_id: string;
      run_id: string;
      thread_id: string;
      node_id: string | null;
      agent_id: string | null;
      adapter_kind: string;
      plan_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      planId: row.plan_id,
      runId: row.run_id,
      threadId: row.thread_id,
      nodeId: row.node_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      adapterKind: row.adapter_kind,
      createdAt: row.created_at,
      plan: fromJson<ToolExposurePlan>(row.plan_json)
    }));
  }

  /**
   * v0.2：写入 run 内部计划状态（update_plan 工具使用）。
   */
  upsertRunPlan(runId: string, threadId: string, plan: PlanState): void {
    this.db
      .prepare(
        `INSERT INTO run_plans (run_id, thread_id, plan_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           plan_json = excluded.plan_json,
           updated_at = excluded.updated_at`
      )
      .run(runId, threadId, toJson(plan), nowIso());
  }

  getRunPlan(runId: string): PlanState | null {
    const row = this.db
      .prepare(`SELECT plan_json FROM run_plans WHERE run_id = ?`)
      .get(runId) as { plan_json: string } | undefined;
    return row ? fromJson<PlanState>(row.plan_json) : null;
  }

  /**
   * v0.2：写入/更新 request_user_input 请求状态。
   */
  upsertUserInputRequest(input: {
    requestId: string;
    runId: string;
    threadId: string;
    nodeId?: string;
    agentId?: string;
    state: UserInputRequestState;
    payload: JsonValue;
  }): void {
    this.db
      .prepare(
        `INSERT INTO user_input_requests (
          request_id, run_id, thread_id, node_id, agent_id, status,
          payload_json, answer_json, requested_at, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET
          status = excluded.status,
          payload_json = excluded.payload_json,
          answer_json = excluded.answer_json,
          answered_at = excluded.answered_at`
      )
      .run(
        input.requestId,
        input.runId,
        input.threadId,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.state.status,
        toJson(input.payload),
        input.state.answer ? toJson(input.state.answer) : null,
        input.state.requestedAt ?? nowIso(),
        input.state.answeredAt ?? null
      );
  }

  getUserInputRequests(runId: string): Array<{
    requestId: string;
    status: string;
    payload: JsonValue;
    answer?: JsonValue;
    requestedAt: string;
    answeredAt?: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT request_id, status, payload_json, answer_json, requested_at, answered_at
         FROM user_input_requests
         WHERE run_id = ?
         ORDER BY requested_at DESC`
      )
      .all(runId) as Array<{
      request_id: string;
      status: string;
      payload_json: string;
      answer_json: string | null;
      requested_at: string;
      answered_at: string | null;
    }>;
    return rows.map((row) => ({
      requestId: row.request_id,
      status: row.status,
      payload: fromJson<JsonValue>(row.payload_json),
      answer: row.answer_json ? fromJson<JsonValue>(row.answer_json) : undefined,
      requestedAt: row.requested_at,
      answeredAt: row.answered_at ?? undefined
    }));
  }

  listUserInputRequestRows(runId: string): UserInputRequestRow[] {
    const rows = this.db
      .prepare(
        `SELECT request_id, run_id, thread_id, node_id, agent_id, status, payload_json, answer_json, requested_at, answered_at
         FROM user_input_requests
         WHERE run_id = ?
         ORDER BY requested_at DESC`
      )
      .all(runId) as Array<{
      request_id: string;
      run_id: string;
      thread_id: string;
      node_id: string | null;
      agent_id: string | null;
      status: string;
      payload_json: string;
      answer_json: string | null;
      requested_at: string;
      answered_at: string | null;
    }>;
    return rows.map((row) => ({
      requestId: row.request_id,
      runId: row.run_id,
      threadId: row.thread_id,
      nodeId: row.node_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      status: row.status,
      payload: fromJson<JsonValue>(row.payload_json),
      answer: row.answer_json ? fromJson<JsonValue>(row.answer_json) : undefined,
      requestedAt: row.requested_at,
      answeredAt: row.answered_at ?? undefined
    }));
  }

  recordStatePatch(input: {
    threadId: string;
    checkpointId: string;
    runId?: string;
    patchKind: "state_patch" | "prompt_override";
    operator?: string;
    reason: string;
    patch: JsonValue;
  }): void {
    this.db
      .prepare(
        `INSERT INTO state_patches (
          thread_id, checkpoint_id, run_id, patch_kind, operator, reason, patch_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.threadId,
        input.checkpointId,
        input.runId ?? null,
        input.patchKind,
        input.operator ?? null,
        input.reason,
        toJson(input.patch),
        nowIso()
      );
  }

  getPromptOverridePatchesForCheckpoint(threadId: string, checkpointId: string): JsonValue[] {
    const rows = this.db
      .prepare(
        `SELECT patch_json FROM state_patches
         WHERE thread_id = ? AND checkpoint_id = ? AND patch_kind = 'prompt_override'
         ORDER BY id ASC`
      )
      .all(threadId, checkpointId) as Array<{ patch_json: string }>;
    return rows.map((row) => fromJson<JsonValue>(row.patch_json));
  }

  recordFork(input: {
    parentRunId: string;
    parentCheckpointId: string;
    childRunId: string;
    threadId: string;
    reason: string;
    operator?: string;
  }): ForkRunResponse {
    this.db
      .prepare(
        `INSERT INTO fork_relations (
          parent_run_id, parent_checkpoint_id, child_run_id, thread_id, reason, operator, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.parentRunId,
        input.parentCheckpointId,
        input.childRunId,
        input.threadId,
        input.reason,
        input.operator ?? null,
        nowIso()
      );

    return {
      parentRunId: input.parentRunId,
      parentCheckpointId: input.parentCheckpointId,
      newRunId: input.childRunId,
      threadId: input.threadId,
      status: "created"
    };
  }

  upsertCheckpointIndex(input: {
    threadId: string;
    checkpointId: string;
    parentCheckpointId?: string;
    runId?: string;
    metadata?: JsonValue;
  }): void {
    this.db
      .prepare(
        `INSERT INTO run_checkpoints_index (
          thread_id, run_id, checkpoint_id, parent_checkpoint_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, checkpoint_id) DO UPDATE SET
          run_id = COALESCE(excluded.run_id, run_checkpoints_index.run_id),
          parent_checkpoint_id = COALESCE(excluded.parent_checkpoint_id, run_checkpoints_index.parent_checkpoint_id),
          metadata_json = COALESCE(excluded.metadata_json, run_checkpoints_index.metadata_json)`
      )
      .run(
        input.threadId,
        input.runId ?? null,
        input.checkpointId,
        input.parentCheckpointId ?? null,
        input.metadata ? toJson(input.metadata) : null,
        nowIso()
      );
  }

  listCheckpointIndex(threadId: string): Array<{
    checkpointId: string;
    parentCheckpointId?: string;
    runId?: string;
    metadata?: JsonValue;
  }> {
    const rows = this.db
      .prepare(
        `SELECT checkpoint_id, parent_checkpoint_id, run_id, metadata_json
         FROM run_checkpoints_index
         WHERE thread_id = ?
         ORDER BY id DESC`
      )
      .all(threadId) as Array<{
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
      run_id: string | null;
      metadata_json: string | null;
    }>;
    return rows.map((row) => ({
      checkpointId: row.checkpoint_id,
      parentCheckpointId: row.parent_checkpoint_id ?? undefined,
      runId: row.run_id ?? undefined,
      metadata: row.metadata_json ? fromJson<JsonValue>(row.metadata_json) : undefined
    }));
  }

  writeAudit(action: string, targetType: string, targetId: string | null, details?: JsonValue): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(action, targetType, targetId, details ? toJson(details) : null, nowIso());
  }
}
