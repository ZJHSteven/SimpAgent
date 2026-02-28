/**
 * 本文件作用：
 * - Node 适配层对接 core 的 AgentRoundExecutor。
 * - 将 Node 侧 UnifiedProviderClient 适配为 core 需要的 ModelPort（stream 能力）。
 */

import { AgentRoundExecutor as CoreAgentRoundExecutor } from "@simpagent/core/runtime";
import type {
  AgentModelPort,
  AgentRoundExecuteResult,
  AgentRoundExecutorTraceContext,
  AgentRoundTraceSink
} from "@simpagent/core/runtime";
import type { UnifiedModelRequest } from "../types/index.js";
import type { UnifiedProviderClient } from "../providers/index.js";

/**
 * Node 适配器：
 * - 把 providerClient.stream 映射到 core 的 AgentModelPort 接口。
 */
class NodeProviderModelPort implements AgentModelPort {
  constructor(private readonly providerClient: UnifiedProviderClient) {}

  stream(req: UnifiedModelRequest) {
    return this.providerClient.stream(req);
  }
}

/**
 * 保持原有类名不变，减少现有调用方改动范围。
 */
export class AgentRoundExecutor extends CoreAgentRoundExecutor {
  constructor(providerClient: UnifiedProviderClient, traceSink?: AgentRoundTraceSink) {
    super(new NodeProviderModelPort(providerClient), traceSink);
  }
}

export type { AgentRoundExecuteResult, AgentRoundExecutorTraceContext, AgentRoundTraceSink };
