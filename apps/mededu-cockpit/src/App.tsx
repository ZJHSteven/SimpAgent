/**
 * 文件作用：
 * - 作为 `apps/dev-console` 前端入口，组装四区布局：
 *   左侧会话、中间画布、右侧监控、底部日志。
 * - 使用稳定 mock 数据驱动动画，保证可演示、可截图、可复现。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { CanvasPanel } from "./cockpit/components/CanvasPanel";
import { CockpitHeader } from "./cockpit/components/CockpitHeader";
import { ConversationPanel } from "./cockpit/components/ConversationPanel";
import { LogPanel } from "./cockpit/components/LogPanel";
import { MonitorPanel } from "./cockpit/components/MonitorPanel";
import {
  cockpitMeta,
  evidenceCards,
  flowEdges,
  flowNodes,
  flowSteps,
  initialConversation,
  initialLogs
} from "./cockpit/mockData";
import type { ConversationMessage, RuntimeLogRow } from "./cockpit/types";

/** 格式化普通时间（例如：10:43:20）。 */
function formatClock(date: Date): string {
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

/** 格式化带毫秒时间（例如：10:43:20.129）。 */
function formatClockWithMillis(date: Date): string {
  const base = formatClock(date);
  const millis = String(date.getMilliseconds()).padStart(3, "0");
  return `${base}.${millis}`;
}

function App() {
  /** 左侧会话消息。 */
  const [messages, setMessages] = useState<ConversationMessage[]>(initialConversation);
  /** 输入框草稿。 */
  const [draftText, setDraftText] = useState("");
  /** 当前步骤索引。 */
  const [stepIndex, setStepIndex] = useState(0);
  /** 是否自动轮播推演。 */
  const [isRunning, setIsRunning] = useState(true);
  /** 底部日志列表（最新在前）。 */
  const [logs, setLogs] = useState<RuntimeLogRow[]>(initialLogs);
  /** 用于跳过首次步骤变更副作用，避免重复记日志。 */
  const skipFirstStepEffectRef = useRef(true);

  /** 当前步骤对象。 */
  const currentStep = useMemo(() => flowSteps[stepIndex], [stepIndex]);

  /** 自动推进步骤：每 2.6 秒切到下一阶段。 */
  useEffect(() => {
    if (!isRunning) return;

    const timer = window.setInterval(() => {
      setStepIndex((prev) => (prev + 1) % flowSteps.length);
    }, 2600);

    return () => window.clearInterval(timer);
  }, [isRunning]);

  /** 每次步骤切换后写入一条日志。 */
  useEffect(() => {
    if (skipFirstStepEffectRef.current) {
      skipFirstStepEffectRef.current = false;
      return;
    }

    const now = new Date();
    const logRow: RuntimeLogRow = {
      timeText: formatClockWithMillis(now),
      level: currentStep.logLevel,
      source: currentStep.logSource,
      content: currentStep.logContent
    };

    setLogs((prev) => [logRow, ...prev].slice(0, 20));
  }, [currentStep]);

  /** 手动上一步。 */
  function handlePrev() {
    setStepIndex((prev) => (prev - 1 + flowSteps.length) % flowSteps.length);
  }

  /** 手动下一步。 */
  function handleNext() {
    setStepIndex((prev) => (prev + 1) % flowSteps.length);
  }

  /** 暂停 / 继续。 */
  function handleToggle() {
    setIsRunning((prev) => !prev);
  }

  /** 重置到初始状态。 */
  function handleReset() {
    setMessages(initialConversation);
    setLogs(initialLogs);
    setStepIndex(0);
    setIsRunning(true);
    setDraftText("");
    skipFirstStepEffectRef.current = true;
  }

  /** 发送学员新提问。 */
  function handleSendMessage() {
    const text = draftText.trim();
    if (!text) return;

    const now = new Date();
    const newMessage: ConversationMessage = {
      id: `学员-${now.getTime()}`,
      role: "学生",
      content: text,
      timeText: formatClock(now)
    };

    const injectLog: RuntimeLogRow = {
      timeText: formatClockWithMillis(now),
      level: "信息",
      source: "学生",
      content: "新增一条自定义追问，系统将继续推演。"
    };

    setMessages((prev) => [...prev, newMessage].slice(-16));
    setLogs((prev) => [injectLog, ...prev].slice(0, 20));
    setDraftText("");
    setStepIndex(1);
    setIsRunning(true);
  }

  return (
    <div className="cockpit-app">
      <CockpitHeader
        meta={cockpitMeta}
        currentStep={currentStep}
        isRunning={isRunning}
        onPrev={handlePrev}
        onToggle={handleToggle}
        onNext={handleNext}
        onReset={handleReset}
      />

      <main className="main-layout">
        <ConversationPanel messages={messages} draftText={draftText} onDraftChange={setDraftText} onSend={handleSendMessage} />

        <CanvasPanel
          nodes={flowNodes}
          edges={flowEdges}
          currentStep={currentStep}
          isRunning={isRunning}
          onToggleRunning={handleToggle}
        />

        <MonitorPanel steps={flowSteps} currentStepIndex={stepIndex} isRunning={isRunning} evidenceCards={evidenceCards} />
      </main>

      <LogPanel logs={logs} />
    </div>
  );
}

export default App;
