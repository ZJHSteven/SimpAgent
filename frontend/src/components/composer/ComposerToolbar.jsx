/*
 * 文件作用：
 * ComposerToolbar 渲染输入器的 leading、footer、trailing 三个工具区。
 *
 * 当前范围：
 * 工具按钮只保留静态外观和可访问名称；真实上传、听写、模型能力后续再接。
 */

import { Icon } from '../ui/Icon.jsx'

export function ComposerToolbar({ position, canSend = false }) {
  if (position === 'leading') {
    return (
      <div className="[grid-area:leading]">
        <span className="flex" data-state="closed">
          <button
            type="button"
            className="composer-btn"
            data-testid="composer-plus-btn"
            aria-label="添加文件等"
            id="composer-plus-btn"
            aria-haspopup="menu"
            aria-expanded="false"
            data-state="closed"
          >
            <Icon id="6be74c" />
          </button>
        </span>
      </div>
    )
  }

  if (position === 'footer') {
    return (
      <div
        data-testid="composer-footer-actions"
        className="-m-1 max-w-full overflow-x-auto p-1 [grid-area:footer] [scrollbar-width:none]"
      >
        <div className="flex min-w-fit items-center cant-hover:px-1.5 cant-hover:gap-1.5">
          <div>
            <div className="__composer-pill-composite group relative" data-tone="accent">
              <button
                type="button"
                className="__composer-pill-remove"
                aria-label="进阶思考，点击以重试"
              >
                <Icon id="23ce94" size={16} className="icon-sm" />
              </button>
              <button
                type="button"
                className="__composer-pill group/pill"
                data-tone="accent"
                aria-haspopup="menu"
                aria-expanded="false"
                data-state="closed"
              >
                <div className="__composer-pill-icon">
                  <Icon id="127a53" />
                </div>
                <span className="max-w-40 truncate [[data-collapse-labels]_&]:sr-only">
                  进阶思考
                </span>
                <Icon id="ba3792" size={16} className="icon-sm -me-0.5 h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 [grid-area:trailing]">
      <div className="ms-auto flex items-center gap-1.5">
        <span data-state="closed">
          <button
            aria-label="开始听写"
            type="button"
            className="composer-btn h-9 min-h-9 w-9 min-w-9"
          >
            <Icon id="29f921" />
          </button>
        </span>
        <div>
          <button
            id="composer-submit-button"
            aria-label="发送提示"
            data-testid="send-button"
            className="composer-submit-btn composer-submit-button-color h-9 w-9"
            disabled={!canSend}
            type="submit"
          >
            <Icon id="01bab7" />
          </button>
        </div>
      </div>
    </div>
  )
}
