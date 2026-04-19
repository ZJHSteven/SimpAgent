/*
 * 文件作用：
 * 这个文件用 shadcn Sidebar 重建左侧工作区导航。
 *
 * 输入：
 * - threads: 后端返回并经搜索过滤后的会话列表。
 * - activeWorkspace: 当前选中的工作区入口。
 * - activeThreadId: 当前会话 id。
 *
 * 输出：
 * - 一个可折叠、移动端自动抽屉化的 shadcn Sidebar。
 */

import {
  BotIcon,
  BoxesIcon,
  BracesIcon,
  ClipboardListIcon,
  Code2Icon,
  FileCode2Icon,
  FolderTreeIcon,
  GitCommitIcon,
  HammerIcon,
  HistoryIcon,
  LayersIcon,
  MessageSquarePlusIcon,
  MessagesSquareIcon,
  NetworkIcon,
  PackageIcon,
  PlayIcon,
  ScrollTextIcon,
  SearchIcon,
  Settings2Icon,
  TerminalSquareIcon,
} from 'lucide-react'
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'

const WORKSPACE_ITEMS = [
  { id: 'chat', label: 'Chat', icon: MessagesSquareIcon },
  { id: 'agent', label: 'Agent 设置', icon: BotIcon },
  { id: 'graph', label: 'Graph', icon: NetworkIcon },
  { id: 'plans', label: 'Plans', icon: ClipboardListIcon },
  { id: 'queue', label: 'Queue', icon: HistoryIcon },
  { id: 'task', label: 'Task', icon: PlayIcon },
  { id: 'tools', label: 'Tools', icon: HammerIcon },
  { id: 'commit', label: 'Commit', icon: GitCommitIcon },
  { id: 'environment', label: 'Environment', icon: BracesIcon },
  { id: 'files', label: 'Files', icon: FolderTreeIcon },
  { id: 'preview', label: 'Preview', icon: FileCode2Icon },
  { id: 'package', label: 'Package', icon: PackageIcon },
  { id: 'sandbox', label: 'Sandbox', icon: BoxesIcon },
  { id: 'schema', label: 'Schema', icon: LayersIcon },
  { id: 'stack', label: 'Stack Trace', icon: TerminalSquareIcon },
]

export function Sidebar({
  activeThreadId,
  activeWorkspace,
  searchQuery,
  threads,
  onNewChat,
  onSearchChange,
  onSelectThread,
  onWorkspaceChange,
}) {
  // shadcn Sidebar 在移动端会渲染为 Sheet 抽屉。抽屉里的按钮默认不会自动关闭，
  // 所以业务动作完成后需要主动关闭移动端抽屉，避免用户点完“新聊天/Graph”还被侧栏挡住。
  const { isMobile, setOpenMobile } = useSidebar()

  function closeMobileSidebar() {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  function handleNewChat() {
    onNewChat()
    closeMobileSidebar()
  }

  function handleWorkspaceChange(workspaceId) {
    onWorkspaceChange(workspaceId)
    closeMobileSidebar()
  }

  function handleSelectThread(threadId) {
    onSelectThread(threadId)
    closeMobileSidebar()
  }

  return (
    <ShadcnSidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-label="新聊天"
              tooltip="新聊天"
              onClick={handleNewChat}
            >
              <MessageSquarePlusIcon />
              <span>新聊天</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <SidebarInput
            aria-label="搜索聊天"
            className="pl-8"
            placeholder="搜索聊天"
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>工作区</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {WORKSPACE_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeWorkspace === item.id}
                      tooltip={item.label}
                      onClick={() => handleWorkspaceChange(item.id)}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>最近会话</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {threads.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <ScrollTextIcon />
                    <span>暂无会话</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
              {threads.map((thread) => (
                <SidebarMenuItem key={thread.id}>
                  <SidebarMenuButton
                    isActive={thread.id === activeThreadId}
                    tooltip={thread.title || '新的会话'}
                    onClick={() => handleSelectThread(thread.id)}
                  >
                    <ScrollTextIcon />
                    <span>{thread.title || '新的会话'}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activeWorkspace === 'agent'}
              tooltip="Agent 设置"
              onClick={() => handleWorkspaceChange('agent')}
            >
              <Settings2Icon />
              <span>Agent 设置</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </ShadcnSidebar>
  )
}
