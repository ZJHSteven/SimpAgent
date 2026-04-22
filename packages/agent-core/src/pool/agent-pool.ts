/**
 * 本文件实现内存态 AgentPool。
 * 职责：管理 agent 注册、thread 生命周期、消息替换与分支 fork。
 */
import type { IdGenerator, RuntimeClock } from "../types/common.js";
import type { ContextMessage } from "../types/messages.js";
import type { AgentDefinition, ThreadState } from "../types/thread.js";

export class AgentPool {
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly threads = new Map<string, ThreadState>();

  constructor(
    private readonly clock: RuntimeClock,
    private readonly idGenerator: IdGenerator
  ) {}

  registerAgent(agent: AgentDefinition): void {
    // 重复 id 时以最后一次注册覆盖，便于热更新场景替换定义。
    this.agents.set(agent.id, agent);
  }

  /**
   * 生成当前内存中尚未使用的 thread id。
   *
   * 为什么保留循环：
   * - UUID v7 的碰撞概率极低，但这里仍然做一次 Map 检查，避免极端情况下的重复。
   * - 这样即便测试里注入固定 ID，也能尽早暴露问题。
   */
  private nextUnusedThreadId(): string {
    let threadId = this.idGenerator.nextId();

    while (this.threads.has(threadId)) {
      threadId = this.idGenerator.nextId();
    }

    return threadId;
  }

  getAgent(agentId: string): AgentDefinition {
    const agent = this.agents.get(agentId);

    if (agent === undefined) {
      throw new Error(`找不到 agent：${agentId}`);
    }

    return agent;
  }

  createThread(input: { readonly agentId: string; readonly title?: string }): ThreadState {
    // 先校验 agent 存在，避免创建悬空 thread。
    this.getAgent(input.agentId);

    const now = this.clock.now();
    const thread: ThreadState = {
      id: this.nextUnusedThreadId(),
      agentId: input.agentId,
      title: input.title ?? "新的会话",
      createdAt: now,
      updatedAt: now,
      messages: []
    };

    this.threads.set(thread.id, thread);
    return thread;
  }

  /**
   * 恢复已经持久化的 thread 快照。
   *
   * 输入：
   * - thread: 从 TraceStore、数据库或其它持久层读取出来的完整会话快照。
   *
   * 输出：
   * - 恢复后的 thread 本身，方便 server 启动流程统计或继续处理。
   *
   * 核心逻辑：
   * - 先校验 thread 绑定的 agent 仍然存在，避免恢复出无法运行的新会话。
   * - 再按原 id 放回内存 Map，让 `GET /threads` 与后续 run 能继续使用历史会话。
   */
  restoreThread(thread: ThreadState): ThreadState {
    this.getAgent(thread.agentId);
    this.threads.set(thread.id, thread);
    return thread;
  }

  getThread(threadId: string): ThreadState {
    const thread = this.threads.get(threadId);

    if (thread === undefined) {
      throw new Error(`找不到 thread：${threadId}`);
    }

    return thread;
  }

  listThreads(): readonly ThreadState[] {
    return [...this.threads.values()];
  }

  replaceThreadMessages(threadId: string, messages: readonly ContextMessage[]): ThreadState {
    const current = this.getThread(threadId);
    const next: ThreadState = {
      ...current,
      updatedAt: this.clock.now(),
      messages
    };

    this.threads.set(threadId, next);
    return next;
  }

  /**
   * 更新 thread 标题。
   *
   * 典型场景：
   * - 新建会话默认叫“新的会话”。
   * - 用户首次发送消息后，server 用输入内容生成一个短标题，侧栏即可显示有意义的历史记录。
   */
  updateThreadTitle(threadId: string, title: string): ThreadState {
    const current = this.getThread(threadId);
    const next: ThreadState = {
      ...current,
      title,
      updatedAt: this.clock.now()
    };

    this.threads.set(threadId, next);
    return next;
  }

  forkThread(input: {
    readonly sourceThreadId: string;
    readonly fromMessageId: string;
    readonly title?: string;
  }): ThreadState {
    const source = this.getThread(input.sourceThreadId);
    const messageIndex = source.messages.findIndex((message) => message.id === input.fromMessageId);

    if (messageIndex < 0) {
      throw new Error(`无法 fork：消息不存在 ${input.fromMessageId}`);
    }

    const now = this.clock.now();
    const forked: ThreadState = {
      id: this.nextUnusedThreadId(),
      agentId: source.agentId,
      title: input.title ?? `${source.title} 的分支`,
      createdAt: now,
      updatedAt: now,
      messages: source.messages.slice(0, messageIndex + 1),
      parentThreadId: source.id,
      forkedFromMessageId: input.fromMessageId
    };

    this.threads.set(forked.id, forked);
    return forked;
  }
}
