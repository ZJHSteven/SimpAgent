/*
 * 文件作用：
 * Topbar 渲染聊天主区域顶部栏，包括移动端打开侧栏、模型选择和右侧操作按钮。
 *
 * 迁移修复：
 * 旧页面模型按钮缺少可访问名称，导致测试和辅助技术都找不到“选择模型”。
 * React 版显式添加 aria-label="选择模型"。
 */

import { Icon } from '../ui/Icon.jsx'

export function Topbar({ onOpenMobileSidebar, onNewChat }) {
  return (
    <header className="topbar-new flex items-center justify-between px-3 h-14 sticky top-0 bg-white/80 backdrop-blur-md z-20">
      <div className="flex flex-1 items-center gap-2">
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-black/5 active:opacity-50 md:hidden"
          aria-label="打开侧栏"
          id="top-mobile-menu-button"
          onClick={onOpenMobileSidebar}
        >
          <Icon id="38e54b" />
        </button>

        <button
          type="button"
          className="group flex items-center gap-1.5 rounded-xl px-3 py-2 hover:bg-black/5 focus-visible:outline-none transition-colors"
          aria-label="选择模型"
        >
          <span className="header-wordmark text-lg leading-none">
            ChatGPT 4o
          </span>
          <Icon id="ba3792" size={16} className="text-black/30 mt-0.5" />
        </button>
      </div>

      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          id="top-new-chat-button"
          className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-black/5"
          aria-label="新聊天"
          onClick={onNewChat}
        >
          <Icon id="3a5c87" />
        </button>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-black/5"
          aria-label="分享对话"
        >
          <Icon id="630ca2" />
        </button>

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-black/5"
          aria-label="打开对话选项"
        >
          <Icon id="f6d0e2" />
        </button>
      </div>
    </header>
  )
}
