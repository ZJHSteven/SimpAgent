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
import { useSimpAgentChat } from './hooks/useSimpAgentChat.js'

function App() {
  // 当前左侧工作区入口。chat 是主聊天，其余入口用于展示配置、图流和诊断组件。
  const [activeWorkspace, setActiveWorkspace] = useState('chat')

  // 右侧思考栏仍然由 App 托管，因为消息里的“已思考”按钮和右栏关闭按钮都会改它。
  const [isThoughtPanelOpen, setIsThoughtPanelOpen] = useState(false)

  // 模型选择是纯前端状态，会随下一次 run 一起传给后端；后端不消费时也不影响聊天。
  const [selectedModel, setSelectedModel] = useState('gpt-4o')

  // chatState 是前后端真实连接后的聊天业务状态。
  const chatState = useSimpAgentChat()

  // 思考面板支持按钮切换和关闭按钮强制关闭。
  const toggleThoughtPanel = useCallback(() => {
    setActiveWorkspace('chat')
    setIsThoughtPanelOpen((isOpen) => !isOpen)
  }, [])

  // 关闭思考面板使用独立函数，便于传给关闭按钮。
  const closeThoughtPanel = useCallback(() => {
    setIsThoughtPanelOpen(false)
  }, [])

  const handleNewChat = useCallback(() => {
    void chatState.onNewChat()
    setActiveWorkspace('chat')
    setIsThoughtPanelOpen(false)
  }, [chatState])

  const handleSelectThread = useCallback(
    (threadId) => {
      void chatState.onSelectThread(threadId)
      setActiveWorkspace('chat')
    },
    [chatState],
  )

  const handleWorkspaceChange = useCallback((workspaceId) => {
    setActiveWorkspace(workspaceId)
  }, [])

  const handleSendMessage = useCallback(
    (text, options = {}) =>
      chatState.onSendMessage(text, {
        ...options,
        model: selectedModel,
      }),
    [chatState, selectedModel],
  )

  return (
    <AppShell
      activeWorkspace={activeWorkspace}
      activeThreadId={chatState.activeThreadId}
      composerHelp={chatState.composerHelp}
      isBusy={chatState.isBusy}
      isThoughtPanelOpen={isThoughtPanelOpen}
      isWaitingForApproval={chatState.isWaitingForApproval}
      messages={chatState.messages}
      pendingApprovals={chatState.pendingApprovals}
      runStatus={chatState.runStatus}
      searchQuery={chatState.searchQuery}
      selectedModel={selectedModel}
      thoughtSteps={chatState.thoughtSteps}
      threads={chatState.visibleThreads}
      onCloseThoughtPanel={closeThoughtPanel}
      onComposerInput={chatState.onComposerInput}
      onEmptySubmit={chatState.onEmptySubmit}
      onModelChange={setSelectedModel}
      onNewChat={handleNewChat}
      onSearchChange={chatState.setSearchQuery}
      onSelectThread={handleSelectThread}
      onSendMessage={handleSendMessage}
      onToggleThoughtPanel={toggleThoughtPanel}
      onToolApproval={chatState.onToolApproval}
      onWorkspaceChange={handleWorkspaceChange}
    />
  )
}

export default App
