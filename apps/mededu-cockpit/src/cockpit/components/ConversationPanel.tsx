/**
 * 文件作用：
 * - 左侧会话区：展示多角色发言，并允许用户注入新提问。
 * - 该组件保持“展示 + 事件抛出”模式，避免在子组件里写业务状态。
 */

import type { ConversationMessage } from "../types";

interface ConversationPanelProps {
  messages: ConversationMessage[];
  draftText: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}

function isStudent(role: ConversationMessage["role"]): boolean {
  return role === "学生";
}

function roleClassName(role: ConversationMessage["role"]): string {
  if (role === "虚拟患者") return "tag-patient";
  if (role === "临床专家") return "tag-clinical";
  if (role === "基础研究专家") return "tag-research";
  if (role === "临床导师") return "tag-mentor";
  return "tag-student";
}

export function ConversationPanel(props: ConversationPanelProps) {
  const { messages, draftText, onDraftChange, onSend } = props;

  return (
    <section className="panel conversation-panel">
      <div className="panel-head">
        <h2>实时会话区</h2>
        <span className="small-live">
          <span className="dot" aria-hidden />
          会话畅通
        </span>
      </div>

      <div className="conversation-list">
        {messages.map((message) => {
          const fromStudent = isStudent(message.role);
          return (
            <article key={message.id} className={`message-row ${fromStudent ? "from-student" : "from-others"}`}>
              <div className="meta-line">
                <span className={`role-tag ${roleClassName(message.role)}`}>{message.role}</span>
                <span className="time-text">{message.timeText}</span>
              </div>
              <div className={`bubble ${fromStudent ? "bubble-student" : "bubble-others"}`}>{message.content}</div>
            </article>
          );
        })}
      </div>

      <div className="composer">
        <label htmlFor="input-box">提问注入</label>
        <div className="composer-row">
          <input
            id="input-box"
            value={draftText}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="请输入希望学生提出的追问"
          />
          <button type="button" onClick={onSend}>
            发送
          </button>
        </div>
      </div>
    </section>
  );
}
