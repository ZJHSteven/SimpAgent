/*
 * 文件作用：
 * 这个文件集中封装 SimpChat 前端访问 SimpAgent 后端的所有 HTTP/SSE 细节。
 *
 * 为什么要单独抽出来：
 * 1. React 组件只关心“创建会话、发送消息、监听事件”，不应该到处拼 URL。
 * 2. 以后如果后端路径、鉴权、错误格式变化，只需要改这一层。
 * 3. 测试可以稳定 mock `/api/...`，不用跟组件内部实现耦合。
 */

// 默认走 Vite proxy 的 `/api` 前缀；部署到其它环境时可通过环境变量覆盖。
const DEFAULT_API_BASE = '/api'

/**
 * 规范化 API base。
 *
 * 输入：
 * - rawBase: 可能来自 `import.meta.env.VITE_SIMPAGENT_API_BASE` 的字符串。
 *
 * 输出：
 * - 去掉末尾斜杠后的 base，例如 `/api` 或 `https://example.com/api`。
 */
function normalizeApiBase(rawBase) {
  const base = rawBase || DEFAULT_API_BASE
  return base.endsWith('/') ? base.slice(0, -1) : base
}

export const SIMPAGENT_API_BASE = normalizeApiBase(
  import.meta.env.VITE_SIMPAGENT_API_BASE,
)

/**
 * 拼接后端 URL。
 *
 * path 统一要求以 `/` 开头，调用点可读性更好。
 */
function apiUrl(path) {
  return `${SIMPAGENT_API_BASE}${path}`
}

/**
 * 读取 JSON 响应，并把非 2xx 响应转换成 Error。
 *
 * 输入：
 * - path: 后端路径，例如 `/conversations`。
 * - options: fetch 原生配置。
 *
 * 输出：
 * - 后端返回的 JSON 对象。
 *
 * 异常：
 * - 网络失败会由 fetch 自己抛出。
 * - 后端返回 4xx/5xx 时抛出带 message 的 Error，便于 UI 显示。
 */
async function requestJson(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = body.message || `请求失败：HTTP ${response.status}`
    throw new Error(message)
  }

  return body
}

/**
 * 获取 conversation 列表。
 *
 * 说明：
 * - 前端 UI 里仍然沿用 `thread` 这个词描述“左侧历史会话”。
 * - 但后端 HTTP API 命名已经统一切到 `conversation`，这里必须按后端真实路由发请求。
 */
export function listThreads() {
  return requestJson('/conversations')
}

/**
 * 获取 provider 当前可用的模型列表。
 *
 * 这个接口直接对应后端 `GET /models`，用于后续把“选择模型”按钮真正接成下拉菜单。
 */
export function listModels() {
  return requestJson('/models')
}

/**
 * 创建新 conversation。
 */
export function createThread(input = {}) {
  return requestJson('/conversations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * 读取单个 conversation 快照。
 */
export function getThread(threadId) {
  return requestJson(`/conversations/${encodeURIComponent(threadId)}`)
}

/**
 * 在指定 conversation 上启动一次 run。
 */
export function startRun(threadId, input) {
  return requestJson(`/conversations/${encodeURIComponent(threadId)}/runs`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  })
}

/**
 * 提交工具审批结果。
 */
export function submitToolApproval(runId, toolCallId, decision, reason) {
  return requestJson(
    `/runs/${encodeURIComponent(runId)}/tool-approvals/${encodeURIComponent(
      toolCallId,
    )}`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision,
        ...(reason === undefined ? {} : { reason }),
      }),
    },
  )
}

/**
 * 打开 run 的 SSE 事件流。
 *
 * 输入：
 * - runId: 后端 `POST /conversations/:id/runs` 返回的 runId。
 * - handlers: 各类事件回调；当前统一交给 onEvent 即可。
 *
 * 输出：
 * - 一个 close 函数，组件卸载或切换 thread 时必须调用，避免旧连接继续写状态。
 */
export function openRunEvents(runId, handlers) {
  const source = new EventSource(
    apiUrl(`/runs/${encodeURIComponent(runId)}/events`),
  )
  const eventTypes = [
    'run_started',
    'message_delta',
    'thinking_delta',
    'tool_call',
    'tool_approval_requested',
    'tool_result',
    'trace_snapshot',
    'error',
    'done',
  ]

  for (const type of eventTypes) {
    source.addEventListener(type, (event) => {
      handlers.onEvent(JSON.parse(event.data))
    })
  }

  source.onerror = () => {
    handlers.onError?.()
  }

  return () => {
    source.close()
  }
}
