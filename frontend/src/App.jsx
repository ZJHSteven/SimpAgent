/*
 * 文件作用：
 * 这个文件是 SimpChat React 前端的顶层状态容器。
 *
 * 当前版本已经接入真实 SimpAgent 后端：
 * 1. thread 列表、当前消息、发送 run、SSE 流式输出都来自 `apps/server`。
 * 2. 组件仍然只负责渲染，复杂的 API/SSE 状态管理放在 `useSimpAgentChat`。
 * 3. 设置弹窗和布局开关仍留在 App 中，因为它们是纯前端 UI 状态，不属于后端 thread。
 */

import { useCallback, useState } from 'react'
import { AppShell } from './components/layout/AppShell.jsx'
import { SettingsModal } from './components/settings/SettingsModal.jsx'
import { useSimpAgentChat } from './hooks/useSimpAgentChat.js'

function App() {
  // sidebarState 控制桌面端左侧栏宽度：expanded 是完整侧栏，collapsed 是窄 rail。
  const [sidebarState, setSidebarState] = useState('collapsed')

  // isMobileSidebarOpen 控制移动端抽屉侧栏，和桌面端 grid 宽度分开，避免两个状态互相干扰。
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

  // isThoughtPanelOpen 控制右侧思考面板的 data-open 和触发按钮 aria-expanded。
  const [isThoughtPanelOpen, setIsThoughtPanelOpen] = useState(false)

  // isSettingsOpen 控制设置弹窗的显示。
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // chatState 是前后端真实连接后的聊天业务状态。
  const chatState = useSimpAgentChat()

  // 切换桌面侧栏：函数式 setState 可以避免闭包读到旧状态。
  const toggleDesktopSidebar = useCallback(() => {
    setSidebarState((currentState) =>
      currentState === 'collapsed' ? 'expanded' : 'collapsed',
    )
  }, [])

  // 移动端侧栏显式打开，顶部按钮只绑定一次。
  const openMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(true)
  }, [])

  // 移动端侧栏显式关闭，遮罩、关闭按钮、新聊天都会复用这个函数。
  const closeMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(false)
  }, [])

  // 思考面板支持按钮切换和关闭按钮强制关闭。
  const toggleThoughtPanel = useCallback(() => {
    setIsThoughtPanelOpen((isOpen) => !isOpen)
  }, [])

  // 关闭思考面板使用独立函数，便于传给关闭按钮。
  const closeThoughtPanel = useCallback(() => {
    setIsThoughtPanelOpen(false)
  }, [])

  const handleNewChat = useCallback(() => {
    void chatState.onNewChat()
    setIsMobileSidebarOpen(false)
  }, [chatState])

  const handleSelectThread = useCallback(
    (threadId) => {
      void chatState.onSelectThread(threadId)
      setIsMobileSidebarOpen(false)
    },
    [chatState],
  )

  const handleSettingsOpen = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false)
  }, [])

  return (
    <>
      <AppShell
        sidebarState={sidebarState}
        isMobileSidebarOpen={isMobileSidebarOpen}
        isThoughtPanelOpen={isThoughtPanelOpen}
        threads={chatState.visibleThreads}
        activeThreadId={chatState.activeThreadId}
        searchQuery={chatState.searchQuery}
        messages={chatState.messages}
        thoughtSteps={chatState.thoughtSteps}
        composerHelp={chatState.composerHelp}
        isBusy={chatState.isBusy}
        isWaitingForApproval={chatState.isWaitingForApproval}
        onToggleDesktopSidebar={toggleDesktopSidebar}
        onOpenMobileSidebar={openMobileSidebar}
        onCloseMobileSidebar={closeMobileSidebar}
        onToggleThoughtPanel={toggleThoughtPanel}
        onCloseThoughtPanel={closeThoughtPanel}
        onSearchChange={chatState.setSearchQuery}
        onSelectThread={handleSelectThread}
        onSendMessage={chatState.onSendMessage}
        onEmptySubmit={chatState.onEmptySubmit}
        onComposerInput={chatState.onComposerInput}
        onNewChat={handleNewChat}
        onOpenSettings={handleSettingsOpen}
        onToolApproval={chatState.onToolApproval}
      />
      {isSettingsOpen && <SettingsModal onClose={handleSettingsClose} />}
    </>
  )
}

export default App
