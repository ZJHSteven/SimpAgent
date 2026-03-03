/**
 * 文件作用：
 * - 顶部状态栏组件，承载标题、场景信息、运行控制按钮。
 * - 该组件只负责展示和触发事件，不持有业务状态，方便复用与测试。
 */

import type { CockpitMeta, FlowStep } from "../types";

/**
 * 组件输入参数：
 * - meta: 顶部展示的标题与会话元信息。
 * - currentStep: 当前步骤，用于显示“正在执行”的中文状态说明。
 * - isRunning: 是否自动播放流程。
 * - onPrev/onToggle/onNext/onReset: 控制按钮回调。
 */
interface CockpitHeaderProps {
  meta: CockpitMeta;
  currentStep: FlowStep;
  isRunning: boolean;
  onPrev: () => void;
  onToggle: () => void;
  onNext: () => void;
  onReset: () => void;
}

/**
 * 顶部栏：
 * - 左侧：品牌标题与版本；
 * - 中间：流程控制；
 * - 右侧：会话状态与当前步骤。
 */
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
        <span className="status-pill">当前场景：{meta.scenarioName}</span>
        <span className="status-pill step-pill">执行阶段：{currentStep.title}</span>
      </div>
    </header>
  );
}
