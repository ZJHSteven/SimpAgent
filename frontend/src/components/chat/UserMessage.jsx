/*
 * 文件作用：
 * UserMessage 渲染用户消息气泡。
 *
 * 安全点：
 * 用户输入作为 JSX 文本输出，React 会自动转义，不会像 innerHTML 那样执行用户输入里的 HTML。
 */

import { MessageActions } from './MessageActions.jsx'

export function UserMessage({ message }) {
  return (
    <article className="message message--user">
      <h2 className="sr-only">你说：</h2>
      <div data-message-author-role="user" className="w-full relative flex flex-col items-end">
        <div className="user-bubble user-message-bubble-color">
          <div className="whitespace-pre-wrap">{message.text}</div>
        </div>
        <MessageActions />
      </div>
    </article>
  )
}
