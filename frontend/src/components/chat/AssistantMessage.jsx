/*
 * 文件作用：
 * AssistantMessage 渲染助手回复，包括头像、段落、可选表格、可选代码块和思考按钮。
 */

import { Icon } from '../ui/Icon.jsx'
import { ResultTable } from './ResultTable.jsx'

export function AssistantMessage({
  message,
  isThoughtPanelOpen,
  onToggleThoughtPanel,
}) {
  // 旧 HTML 的初始回复是“第一段 -> 表格 -> 解释段 -> 代码块”。
  // 这里按同样顺序渲染，避免迁移后初始消息阅读节奏发生变化。
  const [firstParagraph, ...restParagraphs] = message.paragraphs

  return (
    <article className="message message--assistant">
      <div className="message-meta">
        <Icon id="127a53" className="assistant-avatar" fill="currentColor" />
        <span>SimpChat 说：</span>
      </div>

      <div className="assistant-content">
        {firstParagraph ? <p>{firstParagraph}</p> : null}

        <ResultTable table={message.table} />

        {restParagraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}

        {message.code ? (
          <pre>
            <code>{message.code}</code>
          </pre>
        ) : null}
      </div>

      {message.thought ? (
        <button
          className="thought-toggle"
          id="thought-toggle"
          type="button"
          aria-label="查看思考过程"
          aria-expanded={String(isThoughtPanelOpen)}
          aria-controls="thought-panel"
          onClick={onToggleThoughtPanel}
        >
          <span>{message.thought.label}</span>
          <Icon id="b140e7" />
        </button>
      ) : null}
    </article>
  )
}
