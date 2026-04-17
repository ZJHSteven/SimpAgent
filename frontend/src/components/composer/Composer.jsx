/*
 * 文件作用：
 * Composer 是底部输入器总入口，负责表单提交和输入文本状态。
 *
 * 迁移重点：
 * 旧页面使用 contenteditable + 手写 DOM 事件管理文本。
 * React 版使用受控 textarea，保证输入内容始终在 React state 里。
 */

import { useCallback, useState } from 'react'
import { ComposerHelp } from './ComposerHelp.jsx'
import { ComposerInput } from './ComposerInput.jsx'
import { ComposerToolbar } from './ComposerToolbar.jsx'

export function Composer({
  help,
  onSendMessage,
  onEmptySubmit,
  onComposerInput,
}) {
  // text 是输入框唯一真实值，发送按钮是否可用也由它推导。
  const [text, setText] = useState('')

  // hasText 使用 trim 判断有效输入，避免只输入空格也能发送。
  const hasText = text.trim().length > 0

  const submitText = useCallback(() => {
    const trimmedText = text.trim()

    if (!trimmedText) {
      onEmptySubmit()
      return
    }

    onSendMessage(trimmedText)
    setText('')
  }, [onEmptySubmit, onSendMessage, text])

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault()
      submitText()
    },
    [submitText],
  )

  const handleTextChange = useCallback(
    (nextText) => {
      setText(nextText)
      onComposerInput()
    },
    [onComposerInput],
  )

  return (
    <footer className="composer-wrap">
      <form
        className="composer group/composer w-full"
        id="composer"
        autoComplete="off"
        data-expanded=""
        onSubmit={handleSubmit}
      >
        <div
          className="composer-surface-local bg-token-bg-primary dark:bg-token-bg-elevated-primary corner-superellipse/1.1 cursor-text overflow-clip bg-clip-padding p-2.5 contain-inline-size motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-in-out grid grid-cols-[auto_1fr_auto] [grid-template-areas:'header_header_header'_'leading_primary_trailing'_'._footer_.'] group-data-expanded/composer:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing'] shadow-short-composer"
          data-composer-surface="true"
        >
          <ComposerToolbar position="leading" />

          <ComposerInput
            value={text}
            onChange={handleTextChange}
            onSubmit={submitText}
          />

          <ComposerToolbar position="footer" />

          <ComposerToolbar position="trailing" canSend={hasText} />
        </div>

        <ComposerHelp help={help} />
      </form>
    </footer>
  )
}
