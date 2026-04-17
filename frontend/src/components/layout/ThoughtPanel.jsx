/*
 * 文件作用：
 * ThoughtPanel 渲染右侧“思考详情”抽屉。
 *
 * 迁移重点：
 * 旧页面通过 thoughtPanel.dataset.open 控制显隐。
 * React 版继续输出 data-open，但值来自 props，方便测试和样式复用。
 */

import { thoughtSteps } from '../../lib/chatData.js'
import { Icon } from '../ui/Icon.jsx'

export function ThoughtPanel({ isOpen, onClose }) {
  return (
    <aside
      className="thought-panel"
      id="thought-panel"
      data-open={String(isOpen)}
      aria-label="思考详情"
    >
      <div className="thought-panel__header">
        <h2 className="thought-panel__title">思考</h2>
        <button
          className="thought-panel__close"
          id="thought-panel-close"
          type="button"
          aria-label="关闭思考详情"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="thought-list">
        {thoughtSteps.map((step, index) => (
          <div className="thought-step" key={step.id}>
            <div className="thought-step__rail">
              <Icon
                id={step.iconId}
                className="thought-step__icon"
                fill="currentColor"
              />
              {index < thoughtSteps.length - 1 ? (
                <div className="thought-step__line"></div>
              ) : null}
            </div>
            <div className="thought-step__body">
              <div className="thought-step__title">{step.title}</div>
              {step.text ? (
                <p className="thought-step__text">{step.text}</p>
              ) : null}
              {step.sources ? (
                <div className="source-pill-row">
                  {step.sources.map((source) => (
                    <a
                      className="source-pill"
                      href={source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      key={source.id}
                    >
                      {source.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
