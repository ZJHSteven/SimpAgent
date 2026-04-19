/*
 * 文件作用：
 * ToolApproval 渲染工具调用的人审卡片。
 *
 * 输入：
 * - toolName: 后端请求执行的工具名。
 * - status: pending / approved / denied / done / failed，用于控制按钮和状态文案。
 * - riskSummary: 后端给出的风险摘要。
 * - argumentsText: 模型传给工具的原始 JSON 参数文本。
 * - onAllow / onReject: 用户点击允许或拒绝后的回调，外层会调用后端审批接口。
 */

const STATUS_LABELS = {
  pending: '等待审批',
  approved: '已允许，等待工具结果',
  denied: '已拒绝',
  done: '工具已完成',
  failed: '工具失败',
}

export function ToolApproval({
  toolName,
  status = 'pending',
  riskSummary,
  argumentsText,
  onAllow,
  onReject,
}) {
  const isPending = status === 'pending'

  return (
    <div
      className="tool-approval"
      data-status={status}
      aria-label={`工具审批：${toolName}`}
    >
      <div className="tool-approval__title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="tool-approval__icon"
          aria-hidden="true"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline>
          <polyline points="7.5 19.79 7.5 14.6 3 12"></polyline>
          <polyline points="21 12 16.5 14.6 16.5 19.79"></polyline>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
          <line x1="12" y1="22.08" x2="12" y2="12"></line>
        </svg>
        <span>
          SimpChat 请求使用工具：
          <span className="tool-approval__name">{toolName}</span>
        </span>
      </div>

      <div className="tool-approval__status">
        {STATUS_LABELS[status] ?? status}
      </div>

      {riskSummary ? (
        <p className="tool-approval__summary">{riskSummary}</p>
      ) : null}

      {argumentsText ? (
        <pre className="tool-approval__args">
          <code>{argumentsText}</code>
        </pre>
      ) : null}

      <div className="tool-approval__actions">
        <button type="button" onClick={onReject} disabled={!isPending}>
          拒绝
        </button>
        <button type="button" onClick={onAllow} disabled={!isPending}>
          允许
        </button>
      </div>
    </div>
  )
}
