/*
 * 文件作用：
 * ChatMain 组合主聊天区：顶部栏、消息流、底部输入器。
 *
 * 设计取舍：
 * 这里不保存自己的业务状态，只把 App 传入的数据继续分发给更细的组件。
 */

import { Composer } from '../composer/Composer.jsx'
import { MessageThread } from '../chat/MessageThread.jsx'
import { Topbar } from '../chat/Topbar.jsx'

export function ChatMain({
  messages,
  composerHelp,
  isThoughtPanelOpen,
  onOpenMobileSidebar,
  onToggleThoughtPanel,
  onSendMessage,
  onEmptySubmit,
  onComposerInput,
  onNewChat,
}) {
  return (
    <main className="chat-main" aria-label="聊天主区域">
      <Topbar
        onOpenMobileSidebar={onOpenMobileSidebar}
        onNewChat={onNewChat}
      />

      <MessageThread
        messages={messages}
        isThoughtPanelOpen={isThoughtPanelOpen}
        onToggleThoughtPanel={onToggleThoughtPanel}
      />

      <Composer
        help={composerHelp}
        onSendMessage={onSendMessage}
        onEmptySubmit={onEmptySubmit}
        onComposerInput={onComposerInput}
      />
    </main>
  )
}
