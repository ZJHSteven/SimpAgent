/**
 * 文件作用：
 * - 把当前 run 的 conversationState 渲染成真正可读的对话时间线；
 * - 同时补一个“最近一次 prompt compile 发给模型的消息预览”，方便对照“用户看到什么”与“模型实际收到了什么”。
 *
 * 设计取舍：
 * - 这里优先做“可直接看懂”的聊天视图，而不是继续堆黑底 JSON；
 * - 但也不丢信息：tool message、assistant tool_calls、prompt compile 消息都会尽量结构化显示；
 * - 如果内容仍然复杂，再在主页面保留原始 JSON 折叠区兜底。
 */

import type { ConversationMessageSummary, PromptCompileDetail, RunConversationSummary, RunSummary } from "./types";

type ConversationBubble = {
  id: string;
  role: "system" | "developer" | "user" | "assistant" | "tool";
  title: string;
  body: string;
  meta: string[];
};

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, max = 240): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function safeParseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 把 runtime 的统一消息结构转成更适合前端展示的气泡。
 * 说明：
 * - tool 消息默认会塞一个 JSON 字符串；
 * - 这里先尽量解析出 toolName / ok / output / error，避免用户在主视图里直接啃 JSON。
 */
function buildBubbleFromMessage(message: ConversationMessageSummary, index: number): ConversationBubble {
  if (message.role === "tool") {
    const packet = safeParseRecord(message.content);
    const toolName = typeof packet?.toolName === "string" ? packet.toolName : message.name || "tool";
    const ok = packet?.ok === true ? "成功" : packet?.ok === false ? "失败" : "未知";
    const outputText =
      packet?.output !== undefined
        ? truncateText(compactJson(packet.output), 320)
        : packet?.error !== undefined
          ? truncateText(compactJson(packet.error), 320)
          : truncateText(message.content, 320);
    return {
      id: `${message.role}-${index}`,
      role: "tool",
      title: `工具回显 · ${toolName}`,
      body: outputText,
      meta: [
        `执行结果：${ok}`,
        typeof packet?.toolId === "string" ? `toolId：${packet.toolId}` : "",
        typeof message.toolCallId === "string" ? `toolCallId：${message.toolCallId}` : ""
      ].filter(Boolean)
    };
  }

  const toolCallText =
    Array.isArray(message.toolCalls) && message.toolCalls.length
      ? `\n\n工具调用：\n${message.toolCalls
          .map((toolCall) => `- ${toolCall.toolName}(${compactJson(toolCall.argumentsJson ?? {})})`)
          .join("\n")}`
      : "";

  return {
    id: `${message.role}-${index}`,
    role: message.role,
    title:
      message.role === "assistant"
        ? "Assistant"
        : message.role === "user"
          ? "User"
          : message.role === "developer"
            ? "Developer"
            : "System",
    body: `${message.content || "（空内容）"}${toolCallText}`,
    meta: [
      typeof message.name === "string" && message.name ? `name：${message.name}` : "",
      typeof message.metadata?.agentId === "string" ? `agent：${String(message.metadata.agentId)}` : "",
      typeof message.metadata?.nodeId === "string" ? `node：${String(message.metadata.nodeId)}` : ""
    ].filter(Boolean)
  };
}

function buildConversationBubbles(conversation: RunConversationSummary | null): ConversationBubble[] {
  if (!conversation) return [];
  const bubbles: ConversationBubble[] = [];

  if (conversation.userInput.trim()) {
    bubbles.push({
      id: "run-user-input",
      role: "user",
      title: "User",
      body: conversation.userInput,
      meta: ["本次 run 输入"]
    });
  }

  conversation.messages.forEach((message, index) => {
    bubbles.push(buildBubbleFromMessage(message, index));
  });

  return bubbles;
}

function renderCompileMessageTitle(message: Record<string, unknown>, index: number): string {
  const role = typeof message.role === "string" ? message.role : `message-${index + 1}`;
  const name = typeof message.name === "string" ? ` / ${message.name}` : "";
  return `${role}${name}`;
}

function renderCompileMessageBody(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) return compactJson(content);
  return compactJson(message);
}

export function RunConversationPanel(props: {
  conversation: RunConversationSummary | null;
  runSummary: RunSummary | null;
  promptCompile: PromptCompileDetail | null;
  busyText: string;
  onRefresh: () => void;
}) {
  const bubbles = buildConversationBubbles(props.conversation);

  return (
    <section className="conversation-panel">
      <header className="conversation-panel__header">
        <div>
          <h3>对话视图</h3>
          <p>这里直接展示当前 run 的用户输入、assistant 回复和 tool 回显，不再只看控制面板。</p>
        </div>
        <div className="conversation-panel__meta">
          <span className="pill">run：{props.runSummary?.run_id ?? "未创建"}</span>
          <span className="pill">workflow：{props.conversation?.workflowId ?? props.runSummary?.workflow_id ?? "未选择"}</span>
          <span className="pill">node：{props.conversation?.currentNodeId ?? props.runSummary?.current_node_id ?? "END"}</span>
          <button onClick={props.onRefresh} disabled={!props.runSummary?.run_id}>
            刷新对话
          </button>
        </div>
      </header>

      <div className="conversation-panel__stream">
        {bubbles.length ? (
          bubbles.map((bubble) => (
            <article key={bubble.id} className={`chat-bubble chat-bubble--${bubble.role}`}>
              <div className="chat-bubble__header">
                <strong>{bubble.title}</strong>
                {bubble.meta.length ? <span>{bubble.meta.join(" / ")}</span> : null}
              </div>
              <pre>{bubble.body}</pre>
            </article>
          ))
        ) : (
          <div className="conversation-empty">
            <strong>{props.busyText || "还没有生成对话内容"}</strong>
            <p>填入 API Key、选择 workflow、点击“创建真实 Run”后，这里会直接出现对话时间线。</p>
          </div>
        )}
      </div>

      <section className="conversation-panel__compile">
        <header className="conversation-panel__compile-header">
          <div>
            <h4>最近一次 Prompt 编译预览</h4>
            <p>这一栏展示“实际发给模型”的消息序列，便于核对 PromptUnit 是否按预期插入。</p>
          </div>
          <span className="pill">
            {props.promptCompile ? `${props.promptCompile.finalMessages.length} 条 message` : "暂无 compile"}
          </span>
        </header>
        {props.promptCompile ? (
          <div className="compile-message-list">
            {props.promptCompile.finalMessages.map((message, index) => {
              const item = message as Record<string, unknown>;
              return (
                <article key={`${props.promptCompile?.compileId}-${index}`} className="compile-message-card">
                  <strong>{renderCompileMessageTitle(item, index)}</strong>
                  <pre>{renderCompileMessageBody(item)}</pre>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="conversation-empty conversation-empty--soft">
            <strong>暂无 prompt compile</strong>
            <p>当 run 开始执行并生成 prompt compile 后，这里会自动显示最新一次的模型输入。</p>
          </div>
        )}
      </section>
    </section>
  );
}
