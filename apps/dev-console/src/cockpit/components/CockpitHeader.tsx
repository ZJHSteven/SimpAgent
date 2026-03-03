/**
 * 文件作用：
 * - 渲染页面顶部栏：标题、运行控制、会话状态。
 * - 组件本身不持有业务状态，只通过 props 接收数据与回调。
 */

import type { CockpitMeta, FlowStep } from "../types";

interface CockpitHeaderProps {
  meta: CockpitMeta;
  currentStep: FlowStep;
  isRunning: boolean;
  onPrev: () => void;
  onToggle: () => void;
  onNext: () => void;
  onReset: () => void;
}

export function CockpitHeader(props: CockpitHeaderProps) {
  const { meta, currentStep, isRunning, onPrev, onToggle, onNext, onReset } = props;

  return (
    <header className="cockpit-header">
      <div className="header-brand">
        <div className="brand-mark" aria-hidden>
          医
        </div>
        <div>
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </div>
        <span className="version-pill">{meta.versionText}</span>
      </div>

      <div className="header-controls" role="group" aria-label="流程控制">
        <button type="button" onClick={onPrev}>
          上一步
        </button>
        <button type="button" className={isRunning ? "primary" : "accent"} onClick={onToggle}>
          {isRunning ? "暂停推演" : "继续推演"}
        </button>
        <button type="button" onClick={onNext}>
          下一步
        </button>
        <button type="button" onClick={onReset}>
          重置流程
        </button>
      </div>

      <div className="header-status">
        <span className={`status-pill ${isRunning ? "live" : "hold"}`}>{isRunning ? "实时联机" : "暂缓观察"}</span>
        <span className="status-pill">会话编号：{meta.sessionCode}</span>
        <span className="status-pill">场景：{meta.scenarioName}</span>
        <span className="status-pill step-pill">当前阶段：{currentStep.title}</span>
      </div>
    </header>
  );
}
