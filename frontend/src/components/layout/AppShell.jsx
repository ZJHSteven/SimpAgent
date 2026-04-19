/*
 * 文件作用：
 * AppShell 是 AI Elements 重构后的整页骨架。
 *
 * 核心思路：
 * 1. 左侧使用 shadcn Sidebar 作为工作区导航，不再依赖旧 ChatGPT 复刻 CSS。
 * 2. 中间区域根据左侧入口切换：Chat 是真实聊天，其余入口是配置/诊断/图流面板。
 * 3. 右侧思考栏只在聊天入口打开，用 AI Elements ChainOfThought 渲染可观测步骤。
 */

import { ChatMain } from './ChatMain.jsx'
import { Sidebar } from './Sidebar.jsx'
import { ThoughtPanel } from './ThoughtPanel.jsx'
import { WorkspacePage } from './WorkspacePages.jsx'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export function AppShell({
  activeWorkspace,
  activeThreadId,
  composerHelp,
  isBusy,
  isThoughtPanelOpen,
  isWaitingForApproval,
  messages,
  pendingApprovals,
  runStatus,
  searchQuery,
  selectedModel,
  thoughtSteps,
  threads,
  onCloseThoughtPanel,
  onComposerInput,
  onEmptySubmit,
  onModelChange,
  onNewChat,
  onSearchChange,
  onSelectThread,
  onSendMessage,
  onToggleThoughtPanel,
  onToolApproval,
  onWorkspaceChange,
}) {
  const isChatWorkspace = activeWorkspace === 'chat'

  return (
    <SidebarProvider defaultOpen>
      <Sidebar
        activeThreadId={activeThreadId}
        activeWorkspace={activeWorkspace}
        searchQuery={searchQuery}
        threads={threads}
        onNewChat={onNewChat}
        onSearchChange={onSearchChange}
        onSelectThread={onSelectThread}
        onWorkspaceChange={onWorkspaceChange}
      />

      <SidebarInset className="min-h-svh overflow-hidden">
        {isChatWorkspace ? (
          <div className="flex min-h-svh min-w-0">
            <ChatMain
              composerHelp={composerHelp}
              isBusy={isBusy}
              isThoughtPanelOpen={isThoughtPanelOpen}
              isWaitingForApproval={isWaitingForApproval}
              messages={messages}
              runStatus={runStatus}
              selectedModel={selectedModel}
              onComposerInput={onComposerInput}
              onEmptySubmit={onEmptySubmit}
              onModelChange={onModelChange}
              onNewChat={onNewChat}
              onSendMessage={onSendMessage}
              onToggleThoughtPanel={onToggleThoughtPanel}
              onToolApproval={onToolApproval}
            />

            {isThoughtPanelOpen ? (
              <ThoughtPanel
                isBusy={isBusy}
                pendingApprovals={pendingApprovals}
                thoughtSteps={thoughtSteps}
                onClose={onCloseThoughtPanel}
              />
            ) : null}
          </div>
        ) : (
          <WorkspacePage workspaceId={activeWorkspace} />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
