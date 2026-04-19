/*
 * 文件作用：
 * UserMessage 渲染用户消息气泡。
 *
 * 安全点：
 * 用户输入作为 JSX 文本输出，React 会自动转义，不会像 innerHTML 那样执行用户输入里的 HTML。
 */

import { useState } from 'react'
import { MessageActions } from './MessageActions.jsx'

export function UserMessage({ message }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(message.text)

  const handleEdit = () => {
    setIsEditing(true)
    setEditText(message.text)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditText(message.text)
  }

  const handleSend = () => {
    // TODO: 实现真实的发送逻辑，这可能会通过 context 或 props 传递
    setIsEditing(false)
    message.text = editText
  }

  return (
    <article className="message message--user">
      <h2 className="sr-only">你说：</h2>
      <div data-message-author-role="user" className="w-full relative flex flex-col items-end">
        {isEditing ? (
          <div className="w-full max-w-[80%] flex flex-col gap-2">
            <textarea
              className="user-bubble user-message-bubble-color w-full min-h-[100px] resize-y outline-none focus:ring-2 focus:ring-blue-500"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              style={{ backgroundColor: 'var(--token-bg-secondary)', color: 'var(--token-text-primary)' }}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-black hover:bg-gray-50 transition-colors"
                onClick={handleCancel}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 transition-colors inline-flex items-center gap-1"
                onClick={handleSend}
              >
                {/* 常用对勾图标 */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                发送
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="user-bubble user-message-bubble-color">
              <div className="whitespace-pre-wrap">{message.text}</div>
            </div>
            <MessageActions onEdit={handleEdit} />
          </>
        )}
      </div>
    </article>
  )
}
