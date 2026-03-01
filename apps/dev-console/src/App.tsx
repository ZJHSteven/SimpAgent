/**
 * 本文件作用：
 * - 定义 dev-console 的总路由与外层布局。
 * - 把 7 个页面统一挂在一个“白色苹果风”导航壳中。
 */

import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { AgentStudioPage } from "./pages/AgentStudioPage";
import { WorkflowCanvasPage } from "./pages/WorkflowCanvasPage";
import { MemoryWorldbookPage } from "./pages/MemoryWorldbookPage";
import { RunFusionCockpitPage } from "./pages/RunFusionCockpitPage";
import { TraceInspectorPage } from "./pages/TraceInspectorPage";
import { ReplayForkPage } from "./pages/ReplayForkPage";
import { SystemSettingsPage } from "./pages/SystemSettingsPage";

const NAV_ITEMS = [
  { to: "/agents", label: "Agent Studio" },
  { to: "/workflow", label: "Workflow Canvas" },
  { to: "/memory", label: "Memory & Worldbook" },
  { to: "/run", label: "Run Fusion Cockpit" },
  { to: "/trace", label: "Trace Inspector" },
  { to: "/replay", label: "Replay & Fork" },
  { to: "/settings", label: "System Settings" }
];

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>SimpAgent</h1>
          <p>Dev Console</p>
        </div>
        <nav className="nav-menu">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/agents" element={<AgentStudioPage />} />
          <Route path="/workflow" element={<WorkflowCanvasPage />} />
          <Route path="/memory" element={<MemoryWorldbookPage />} />
          <Route path="/run" element={<RunFusionCockpitPage />} />
          <Route path="/trace" element={<TraceInspectorPage />} />
          <Route path="/replay" element={<ReplayForkPage />} />
          <Route path="/settings" element={<SystemSettingsPage />} />
          <Route path="*" element={<Navigate to="/run" replace />} />
        </Routes>
      </main>
    </div>
  );
}

