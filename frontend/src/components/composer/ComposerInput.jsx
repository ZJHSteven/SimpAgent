/*
 * 文件作用：
 * ComposerInput 渲染真正可输入的受控 textarea。
 *
 * 关键说明：
 * 这个 textarea 继续使用 ProseMirror className，是为了复用现有视觉样式。
 * 但它不再是 contenteditable，文本变化完全由 React value/onChange 管理。
 */

import { useLayoutEffect, useRef } from 'react'

export function ComposerInput({ value, disabled, onChange, onSubmit }) {
  // textareaRef 只用于自动高度，不用于绕过 React 改文本。
  const textareaRef = useRef(null)

  // isComposingRef 记录中文输入法是否正在组词，避免 Enter 被误当作发送。
  const isComposingRef = useRef(false)

  useLayoutEffect(() => {
    if (!textareaRef.current) {
      return
    }

    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
  }, [value])

  function handleKeyDown(event) {
    // 中文输入法正在组词时，Enter 通常用于确认候选词，不能提交表单。
    if (event.isComposing || isComposingRef.current) {
      return
    }

    // Enter 发送，Shift + Enter 保留浏览器默认换行行为。
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="composer-primary -my-2.5 flex min-h-14 items-center overflow-x-hidden px-1.5 [grid-area:primary] group-data-expanded/composer:mb-0 group-data-expanded/composer:px-2.5">
      <div className="wcDTda_prosemirror-parent text-token-text-primary max-h-[max(30svh,5rem)] max-h-52 min-h-[var(--deep-research-composer-extra-height,unset)] flex-1 overflow-auto [scrollbar-width:thin] firefox vertical-scroll-fade-mask">
        <textarea
          className="ProseMirror composer-textarea"
          id="prompt-textarea"
          name="prompt-textarea"
          placeholder="有问题，尽管问"
          aria-label="与 ChatGPT 聊天"
          data-virtualkeyboard="true"
          value={value}
          rows={1}
          disabled={disabled}
          ref={textareaRef}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
        ></textarea>
      </div>
    </div>
  )
}
