/**
 * 本文件作用：
 * - 提供 core 层统一引擎入口 `createRuntimeEngine(deps)`。
 *
 * 设计说明：
 * - core 不绑定 Node/Worker/Tauri 的运行细节；
 * - 具体“如何执行一条 run”由适配层注入 `runExecutor` 完成；
 * - core 负责统一配置合并语义与基础查询接口。
 */

import type { CreateRunRequest, CreateRunResponse, JsonObject, JsonValue } from "../types/index.js";
import type { CoreRuntimeDeps, CoreRuntimeEngine } from "../ports/index.js";

/**
 * 运行执行器：
 * - 适配层可注入自己的 run 执行逻辑（例如 Node 的 LangGraph 引擎，或 Worker 的最小执行器）。
 */
export interface RuntimeRunExecutor {
  createRun(req: CreateRunRequest): Promise<CreateRunResponse>;
  getRunSummary(runId: string): JsonObject | null;
}

/**
 * createRuntimeEngine：
 * - 统一构建 core 引擎；
 * - 如果未注入 runExecutor，会抛出明确错误，避免“静默不可用”。
 */
export function createRuntimeEngine(
  deps: CoreRuntimeDeps,
  runExecutor?: RuntimeRunExecutor
): CoreRuntimeEngine {
  return {
    async createRun(req: CreateRunRequest): Promise<CreateRunResponse> {
      if (!runExecutor) {
        throw new Error("当前 core 引擎未绑定 runExecutor，请在适配层注入具体执行器");
      }
      return runExecutor.createRun(req);
    },
    getRunSummary(runId: string): JsonObject | null {
      if (runExecutor) {
        return runExecutor.getRunSummary(runId);
      }
      return deps.storage.getRunSummary(runId);
    },
    resolveEffectiveConfig<T extends JsonValue>(layers: {
      preset: T;
      userOverride?: Partial<T> | null;
      runtimePatch?: Partial<T> | null;
    }): T {
      return deps.configResolver.resolveConfig(layers);
    }
  };
}
