/*
 * 文件作用：
 * Sidebar 负责左侧导航、历史记录和底部设置入口。
 *
 * 迁移重点：
 * 1. 保留旧页面的 id、aria-label、className，减少视觉和测试偏差。
 * 2. 历史记录从数组渲染，后续接真实会话列表时只换数据源。
 */

import { historyGroups } from '../../lib/chatData.js'
import { Icon } from '../ui/Icon.jsx'

function SidebarAction({ iconId, label, shortcut, onClick }) {
  return (
    <button
      className="sidebar-action __menu-item hoverable"
      type="button"
      aria-label={label}
      onClick={onClick}
    >
      <span className="sidebar-action-icon" aria-hidden="true">
        <Icon id={iconId} />
      </span>
      <span className="sidebar-label">{label}</span>
      {shortcut ? (
        <span className="sidebar-shortcut" aria-hidden="true">
          {shortcut}
        </span>
      ) : null}
    </button>
  )
}

export function Sidebar({
  sidebarState,
  isMobileSidebarOpen,
  onToggleDesktopSidebar,
  onCloseMobileSidebar,
  onNewChat,
}) {
  // aria-expanded 表达“侧栏内容是否展开”，和 data-sidebar-state 保持一致。
  const isExpanded = sidebarState === 'expanded'

  return (
    <aside
      className="sidebar"
      id="sidebar"
      aria-label="聊天侧栏"
      data-open={String(isMobileSidebarOpen)}
    >
      <div className="sidebar-rail-header flex items-center justify-between min-h-[var(--header-height)]">
        <div className="sidebar-rail-spacer"></div>
        <button
          className="sidebar-toggle hover:bg-black/5"
          id="sidebar-toggle"
          type="button"
          aria-label={isExpanded ? '收起边栏' : '打开边栏'}
          aria-expanded={String(isExpanded)}
          aria-controls="sidebar"
          onClick={onToggleDesktopSidebar}
        >
          <Icon id="38e54b" className="sidebar-toggle__main-icon" />
        </button>

        <button
          className="md:hidden sidebar-close-button hover:bg-black/5"
          id="mobile-sidebar-close"
          type="button"
          aria-label="关闭侧栏"
          onClick={onCloseMobileSidebar}
        >
          <Icon id="85f94b" />
        </button>
      </div>

      <div className="brand">
        <Icon id="6be74c" className="brand__image" fill="currentColor" />
        <div>
          <div className="brand__name">SimpChat</div>
          <div className="conversation-subtitle">本地静态复刻</div>
        </div>
      </div>

      <div className="sidebar-body">
        <nav className="sidebar-menu" aria-label="主操作">
          <SidebarAction
            iconId="3a5c87"
            label="新聊天"
            shortcut="Ctrl Shift O"
            onClick={onNewChat}
          />
          <SidebarAction iconId="ac6d36" label="搜索聊天" />
        </nav>

        <div className="history-list flex-1 overflow-y-auto">
          {historyGroups.map((group) => (
            <section key={group.id}>
              <div className="sidebar-section-title">{group.title}</div>
              <div className="sidebar-menu">
                {group.items.map((item) => (
                  <button className="sidebar-action" type="button" key={item}>
                    <span className="sidebar-label ellipsis">{item}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            className="sidebar-profile sidebar-action"
            type="button"
            aria-label="打开设置菜单"
          >
            <span className="sidebar-action-icon" aria-hidden="true">
              <Icon id="settings" />
            </span>
            <span className="sidebar-label">设置</span>
          </button>
          <p className="mt-2 text-[11px] text-muted text-center px-2">
            页面只模拟前端交互，不会向任何 AI 服务发送内容。
          </p>
        </div>
      </div>
    </aside>
  )
}
