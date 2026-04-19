/*
 * 文件作用：
 * AppShell 是 AI Elements 重构后的整页骨架。
 *
 * 核心思路：
 * 1. 左侧使用 shadcn Sidebar 作为工作区导航，不再依赖旧 ChatGPT 复刻 CSS。
 * 2. 中间区域根据左侧入口切换：Chat 是真实聊天，其余入口是配置/诊断/图流面板。
 * 3. 右侧思考栏只在聊天入口打开，用 AI Elements ChainOfThought 渲染可观测步骤。
 */

import { lazy, Suspense } from 'react'
import { ChatMain } from './ChatMain.jsx'
import { Sidebar } from './Sidebar.jsx'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

/*
 * 首屏加载策略说明：
 * Chat 是用户进入页面后的默认工作区，所以 ChatMain 保持同步加载。
 * 其它工作区和右侧思考栏不是首屏必需内容，如果同步导入，会把 ReactFlow、
 * JSX 预览、motion 动画等重型依赖一起塞进首页主入口，导致 Vite 冷启动和线上首屏都变慢。
 */
const LazyThoughtPanel = lazy(() =>
  import('./ThoughtPanel.jsx').then((module) => ({
    default: module.ThoughtPanel,
  })),
)

const LazyWorkspacePage = lazy(() =>
  import('./WorkspacePages.jsx').then((module) => ({
    default: module.WorkspacePage,
  })),
)

function LazyPanelFallback() {
  return (
    <aside
      aria-label="思考详情加载中"
      className="hidden w-96 shrink-0 border-l bg-background p-4 text-sm text-muted-foreground lg:flex"
    >
      正在加载思考详情...
    </aside>
  )
}

function LazyWorkspaceFallback() {
  return (
    <section className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      正在加载工作区...
    </section>
  )
}

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
              <Suspense fallback={<LazyPanelFallback />}>
                <LazyThoughtPanel
                  isBusy={isBusy}
                  pendingApprovals={pendingApprovals}
                  thoughtSteps={thoughtSteps}
                  onClose={onCloseThoughtPanel}
                />
              </Suspense>
            ) : null}
          </div>
        ) : (
          <Suspense fallback={<LazyWorkspaceFallback />}>
            <LazyWorkspacePage workspaceId={activeWorkspace} />
          </Suspense>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
