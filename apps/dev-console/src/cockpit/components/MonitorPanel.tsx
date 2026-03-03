/**
 * 文件作用：
 * - 右侧上下文监控区：展示指标、时间线、证据卡片与数字人视觉。
 * - 重点突出“可观测”与“教学反馈可解释”。
 */

import type { EvidenceCard, FlowStep } from "../types";

interface MonitorPanelProps {
  steps: FlowStep[];
  currentStepIndex: number;
  isRunning: boolean;
  evidenceCards: EvidenceCard[];
}

export function MonitorPanel(props: MonitorPanelProps) {
  const { steps, currentStepIndex, isRunning, evidenceCards } = props;

  const affinity = 69 + ((currentStepIndex * 5) % 22);
  const reasoning = 64 + ((currentStepIndex * 7) % 25);
  const progress = Math.round(((currentStepIndex + 1) / steps.length) * 100);

  return (
    <section className="panel monitor-panel">
      <div className="panel-head">
        <h2>上下文监控区</h2>
        <span className={`monitor-state ${isRunning ? "running" : "paused"}`}>{isRunning ? "流转中" : "暂停中"}</span>
      </div>

      <div className="metric-card">
        <div className="metric-title">患者信任度</div>
        <div className="metric-value">{affinity}</div>
        <div className="metric-scale">满分 100</div>
        <div className="progress-track">
          <div className="progress-fill warm" style={{ width: `${affinity}%` }} />
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-title">推理完整度</div>
        <div className="metric-value">{reasoning}</div>
        <div className="metric-scale">满分 100</div>
        <div className="progress-track">
          <div className="progress-fill cool" style={{ width: `${reasoning}%` }} />
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-title">流程推进度</div>
        <div className="metric-value">{progress}%</div>
        <div className="metric-scale">已完成 {currentStepIndex + 1} / {steps.length} 阶段</div>
        <div className="progress-track">
          <div className="progress-fill neutral" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="digital-human-card">
        <div className="digital-stage" aria-hidden>
          <div className="digital-head" />
          <div className="digital-body" />
          <div className="digital-halo" />
        </div>
        <div className="digital-text">
          <strong>数字患者形象</strong>
          <span>支持表情、语气和病史叙述的一致化呈现</span>
        </div>
      </div>

      <section className="timeline-card">
        <h3>流程时间线</h3>
        <div className="timeline-list">
          {steps.map((step, index) => {
            const status = index < currentStepIndex ? "done" : index === currentStepIndex ? "current" : "todo";
            return (
              <article key={step.id} className={`timeline-item ${status}`}>
                <div className="timeline-dot" aria-hidden />
                <div className="timeline-content">
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="evidence-card">
        <h3>证据与拓展阅读</h3>
        <div className="evidence-list">
          {evidenceCards.map((card) => (
            <article key={card.title} className="evidence-item">
              <strong>{card.title}</strong>
              <span className="source">来源：{card.source}</span>
              <p>{card.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
