/*
 * 文件作用：
 * MessageThread 负责渲染聊天流，并在消息数量变化后滚动到底部。
 *
 * React 官方建议：
 * 普通 DOM 内容由 React 渲染；滚动这类浏览器能力可以用 ref 访问真实 DOM 节点。
 */

import { useEffect, useRef } from 'react'
import { AssistantMessage } from './AssistantMessage.jsx'
import { UserMessage } from './UserMessage.jsx'

export function MessageThread({
  messages,
  isThoughtPanelOpen,
  onToggleThoughtPanel,
  onToolApproval,
}) {
  // threadRef 只用于滚动容器，不用于直接增删消息 DOM。
  const threadRef = useRef(null)

  useEffect(() => {
    // requestAnimationFrame 等待本轮渲染提交后再滚动，避免滚到旧高度。
    requestAnimationFrame(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight
      }
    })
  }, [messages.length])

  return (
    <section className="thread" id="thread" aria-live="polite" ref={threadRef}>
      <div className="thread__inner" id="message-list">
        {messages.map((message) =>
          message.role === 'user' ? (
            <UserMessage message={message} key={message.id} />
          ) : (
            <AssistantMessage
              message={message}
              isThoughtPanelOpen={isThoughtPanelOpen}
              onToggleThoughtPanel={onToggleThoughtPanel}
              onToolApproval={onToolApproval}
              key={message.id}
            />
          ),
        )}
      </div>
    </section>
  )
}
