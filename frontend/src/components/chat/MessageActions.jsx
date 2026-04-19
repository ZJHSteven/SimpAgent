/*
 * 文件作用：
 * MessageActions 渲染用户消息下方的复制、编辑按钮。
 *
 * 当前范围：
 * 本轮只迁移静态界面和本地交互，所以按钮先保持视觉与可访问名称，不实现真实复制/编辑。
 */

import { Icon } from '../ui/Icon.jsx'

export function MessageActions({ onEdit }) {
  return (
    <div className="message-actions">
      <button
        className="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg"
        aria-label="复制消息"
        data-testid="copy-turn-action-button"
        data-state="closed"
        type="button"
      >
        <span className="flex items-center justify-center touch:w-10 h-8 w-8">
          <Icon id="ce3544" />
        </span>
      </button>
      <button
        className="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg"
        aria-label="编辑消息"
        data-state="closed"
        type="button"
        onClick={onEdit}
      >
        <span className="flex items-center justify-center touch:w-10 h-8 w-8">
          <Icon id="6d87e1" />
        </span>
      </button>
    </div>
  )
}
