/**
 * Cloudflare Worker runtime 占位入口。
 * 当前仅声明工厂函数签名，便于上层先完成依赖注入与类型联调。
 */
import type { RuntimeServices } from "@simpagent/agent-core";

/**
 * 创建 Cloudflare Worker runtime。
 * 首版暂未实现，调用即抛错，避免出现“看似可用但行为不完整”的误用。
 */
export function createCloudflareWorkerRuntime(): RuntimeServices {
  throw new Error("runtime-cloudflare-worker 首版只保留接口占位，尚未实现 Cloudflare Worker 环境能力。");
}

