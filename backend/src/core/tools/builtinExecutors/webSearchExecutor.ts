/**
 * 本文件作用：
 * - 实现 `web_search` 内置工具执行器（首版为 mock/占位实现）。
 *
 * 说明：
 * - 真正联网搜索 provider 后续可替换；
 * - 先把统一返回格式与 trace 结构跑通，满足 v0.2 骨架目标。
 */

import type { JsonObject, JsonValue } from "../../../types/index.js";

export async function executeBuiltinWebSearch(args: JsonObject): Promise<JsonValue> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    return { ok: false, error: { code: "MISSING_QUERY", message: "缺少 query" } };
  }
  const maxResults = Math.max(1, Number(args.max_results ?? 5));
  const domains = Array.isArray(args.domains_allowlist) ? args.domains_allowlist.map(String) : [];
  const recencyDays = args.recency_days == null ? undefined : Number(args.recency_days);

  // 首版 mock：用于跑通工具循环与前端调试界面，后续替换为真实 provider。
  return {
    ok: true,
    provider: "mock_web_search",
    query,
    maxResults,
    ...(recencyDays == null ? {} : { recencyDays }),
    domainsAllowlist: domains,
    results: Array.from({ length: Math.min(maxResults, 3) }).map((_, idx) => ({
      title: `Mock Search Result ${idx + 1} for: ${query}`,
      url: `https://example.com/search/${idx + 1}?q=${encodeURIComponent(query)}`,
      snippet: `这是用于调试工具链路的 mock 搜索结果（第 ${idx + 1} 条）。`
    }))
  } as JsonValue;
}
