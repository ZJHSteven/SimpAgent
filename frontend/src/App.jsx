/*
 * 文件作用：
 * 这个文件是 SimpChat React 前端的顶层状态容器。
 *
 * 设计思路：
 * 1. App 只管理“跨区域共享”的状态，例如侧栏、思考面板、消息列表。
 * 2. 具体页面结构交给 layout / chat / composer 子组件负责，避免把整页 JSX 堆在一个文件里。
 * 3. 所有新增消息都通过 setMessages 更新数组，再由 React 重新渲染，替代旧 HTML 里的 appendChild / innerHTML。
 */

import { useCallback, useState } from 'react'
import { AppShell } from './components/layout/AppShell.jsx'
import {
  DEFAULT_HELP_TEXT,
  createAssistantReplyMessage,
  initialMessages,
} from './lib/chatData.js'

function App() {
  // sidebarState 控制桌面端左侧栏宽度：expanded 是完整侧栏，collapsed 是窄 rail。
  const [sidebarState, setSidebarState] = useState('collapsed')

  // isMobileSidebarOpen 控制移动端抽屉侧栏，和桌面端 grid 宽度分开，避免两个状态互相干扰。
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

  // isThoughtPanelOpen 控制右侧思考面板的 data-open 和触发按钮 aria-expanded。
  const [isThoughtPanelOpen, setIsThoughtPanelOpen] = useState(false)

  // messages 是聊天流唯一数据源；用户发送、新聊天重置、模拟助手回复都只改这个数组。
  const [messages, setMessages] = useState(initialMessages)

  // composerHelp 记录输入器下方提示文案；tone 交给 CSS 控制普通/错误颜色。
  const [composerHelp, setComposerHelp] = useState({
    text: DEFAULT_HELP_TEXT,
    tone: 'normal',
  })

  // 切换桌面侧栏：函数式 setState 可以避免闭包读到旧状态。
  const toggleDesktopSidebar = useCallback(() => {
    setSidebarState((currentState) =>
      currentState === 'collapsed' ? 'expanded' : 'collapsed',
    )
  }, [])

  // 移动端侧栏显式打开，顶部按钮只绑定一次，修复旧页面“点一下开关两次”的问题。
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

  // 关闭思考面板使用独立函数，便于传给关闭按钮，不需要让子组件知道内部状态。
  const closeThoughtPanel = useCallback(() => {
    setIsThoughtPanelOpen(false)
  }, [])

  // 发送消息：只接收已经 trim 后的有效文本，追加用户消息和本地模拟助手回复。
  const handleSendMessage = useCallback((text) => {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text,
      },
      createAssistantReplyMessage(text),
    ])

    setComposerHelp({
      text: '消息已发送。本页面当前使用本地模拟回复。',
      tone: 'normal',
    })
  }, [])

  // 空输入不会创建消息，只更新帮助提示。
  const handleEmptySubmit = useCallback(() => {
    setComposerHelp({
      text: '请先输入内容，再发送消息。',
      tone: 'error',
    })
  }, [])

  // 用户开始重新输入时恢复普通提示，避免错误提示一直挂着。
  const handleComposerInput = useCallback(() => {
    setComposerHelp({
      text: DEFAULT_HELP_TEXT,
      tone: 'normal',
    })
  }, [])

  // 新聊天：重置消息流、输入器提示和移动端侧栏。
  const handleNewChat = useCallback(() => {
    setMessages([
      createAssistantReplyMessage('新的本地会话已创建。', {
        id: `assistant-new-${Date.now()}`,
        paragraphs: [
          '新的本地会话已创建。',
          '你可以在底部输入框发送内容，页面会追加用户消息和模拟回复。',
        ],
      }),
    ])

    setComposerHelp({
      text: 'Enter 发送，Shift + Enter 换行。',
      tone: 'normal',
    })

    setIsMobileSidebarOpen(false)
  }, [])

  return (
    <AppShell
      sidebarState={sidebarState}
      isMobileSidebarOpen={isMobileSidebarOpen}
      isThoughtPanelOpen={isThoughtPanelOpen}
      messages={messages}
      composerHelp={composerHelp}
      onToggleDesktopSidebar={toggleDesktopSidebar}
      onOpenMobileSidebar={openMobileSidebar}
      onCloseMobileSidebar={closeMobileSidebar}
      onToggleThoughtPanel={toggleThoughtPanel}
      onCloseThoughtPanel={closeThoughtPanel}
      onSendMessage={handleSendMessage}
      onEmptySubmit={handleEmptySubmit}
      onComposerInput={handleComposerInput}
      onNewChat={handleNewChat}
    />
  )
}

export default App
