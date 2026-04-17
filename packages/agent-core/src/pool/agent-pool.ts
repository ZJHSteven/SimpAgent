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
      id: this.idGenerator.nextId("thread"),
      agentId: input.agentId,
      title: input.title ?? "新的会话",
      createdAt: now,
      updatedAt: now,
      messages: []
    };

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
      id: this.idGenerator.nextId("thread"),
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

