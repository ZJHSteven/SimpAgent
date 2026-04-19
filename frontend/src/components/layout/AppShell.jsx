/*
 * 文件作用：
 * AppShell 是整页布局骨架，负责组合移动遮罩、左侧栏、主聊天区和思考面板。
 *
 * 迁移重点：
 * 旧 HTML 依赖 data-sidebar-state 和 data-open 驱动 CSS。
 * React 版保留这些 data 属性，让现有视觉样式继续工作，但状态来源改为 React。
 */

import { ChatMain } from './ChatMain.jsx'
import { Sidebar } from './Sidebar.jsx'
import { ThoughtPanel } from './ThoughtPanel.jsx'

export function AppShell({
  sidebarState,
  isMobileSidebarOpen,
  isThoughtPanelOpen,
  messages,
  composerHelp,
  onToggleDesktopSidebar,
  onOpenMobileSidebar,
  onCloseMobileSidebar,
  onToggleThoughtPanel,
  onCloseThoughtPanel,
  onSendMessage,
  onEmptySubmit,
  onComposerInput,
  onNewChat,
  onOpenSettings,
}) {
  return (
    <>
      <div
        id="mobile-sidebar-overlay"
        className="md:hidden"
        data-open={String(isMobileSidebarOpen)}
        onClick={onCloseMobileSidebar}
      ></div>

      <div
        className="app-shell"
        id="app-shell"
        data-sidebar-state={sidebarState}
      >
        <Sidebar
          sidebarState={sidebarState}
          isMobileSidebarOpen={isMobileSidebarOpen}
          onToggleDesktopSidebar={onToggleDesktopSidebar}
          onCloseMobileSidebar={onCloseMobileSidebar}
          onNewChat={onNewChat}
          onOpenSettings={onOpenSettings}
        />

        <ChatMain
          messages={messages}
          composerHelp={composerHelp}
          isThoughtPanelOpen={isThoughtPanelOpen}
          onOpenMobileSidebar={onOpenMobileSidebar}
          onToggleThoughtPanel={onToggleThoughtPanel}
          onSendMessage={onSendMessage}
          onEmptySubmit={onEmptySubmit}
          onComposerInput={onComposerInput}
          onNewChat={onNewChat}
        />

        <ThoughtPanel
          isOpen={isThoughtPanelOpen}
          onClose={onCloseThoughtPanel}
        />
      </div>
    </>
  )
}
