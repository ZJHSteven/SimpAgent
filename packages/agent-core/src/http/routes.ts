/**
 * 本文件定义 SimpAgent 内置 HTTP API 的“接口契约”。
 *
 * 分层边界：
 * - `agent-core` 只定义路径、method 和路径参数含义，不依赖 Node / Express / fetch server。
 * - `runtime-node` 负责把这些契约落到 Node HTTP 实现上。
 * - 具体 app 只有在增加应用专属接口时，才需要在自己的 server 层继续扩展。
 */

export const SIMPAGENT_HTTP_ROUTES = {
  conversations: "/conversations",
  conversationById: "/conversations/:conversationId",
  conversationRuns: "/conversations/:conversationId/runs",
  conversationFork: "/conversations/:conversationId/fork",
  conversationEvents: "/conversations/:conversationId/events",
  messageById: "/messages/:messageId",
  runEvents: "/runs/:runId/events",
  toolApproval: "/runs/:runId/tool-approvals/:toolCallId",
  eventById: "/events/:eventId",
  models: "/models",
  presetExport: "/preset/export",
  presetReset: "/preset/reset"
} as const;

/**
 * 将路由模板转换成正则。
 *
 * 说明：
 * - 这里故意只支持 `:param` 这种最小模板语法。
 * - 这样核心包能提供稳定 contract，又不会引入完整路由框架。
 */
function routeTemplateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/:([A-Za-z0-9_]+)/g, "([^/]+)")}$`);
}

/**
 * 匹配一个具体 pathname。
 *
 * 输入：
 * - template: `SIMPAGENT_HTTP_ROUTES` 中的路径模板。
 * - pathname: URL 解析后的 pathname。
 *
 * 输出：
 * - 不匹配返回 undefined。
 * - 匹配返回按模板顺序提取的路径参数数组。
 */
export function matchSimpAgentRoute(template: string, pathname: string): readonly string[] | undefined {
  const match = pathname.match(routeTemplateToRegex(template));
  return match === null ? undefined : match.slice(1);
}
