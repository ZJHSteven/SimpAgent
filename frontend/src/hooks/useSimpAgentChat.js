/*
 * 文件作用：
 * 这个 hook 是 SimpChat 前端接入真实后端后的状态中枢。
 *
 * 它负责：
 * 1. 加载、创建、选择 thread。
 * 2. 发送用户输入并打开 run 的 SSE 事件流。
 * 3. 把后端 AgentEvent 映射成前端可渲染的消息、思考步骤和工具审批卡片。
 * 4. 保持 React 状态不可变，避免直接修改 props 或数组对象导致 UI 与后端快照不一致。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createThread,
  getThread,
  listThreads,
  openRunEvents,
  startRun,
  submitToolApproval,
} from '../lib/simpagentApi.js'
import { DEFAULT_HELP_TEXT } from '../lib/chatData.js'

const ASSISTANT_STREAM_EMPTY_TEXT = '正在思考...'

/**
 * 把后端 content 转成前端可显示的纯文本。
 *
 * 输入：
 * - content: SimpAgent ContextMessage.content，可能是字符串，也可能是多模态分片数组。
 *
 * 输出：
 * - 拼接后的文本。当前 UI 先只显示 text 分片，图片/文件后续再扩展。
 */
function textOfContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('')
}

/**
 * 构造思考面板条目。
 */
function createThoughtStep(id, title, text, status = 'info') {
  return {
    id,
    iconId: status === 'done' ? 'a4763e' : '6b0d8c',
    title,
    text,
    status,
  }
}

/**
 * 根据思考条目数量生成助手消息旁边的按钮文案。
 */
function createThoughtLabel(steps) {
  return steps.length > 0 ? `已思考 ${steps.length} 项` : undefined
}

/**
 * 给最后一条助手消息补上“已思考”按钮。
 */
function attachThoughtToLastAssistant(messages, steps) {
  const label = createThoughtLabel(steps)

  if (label === undefined) {
    return messages
  }

  const lastAssistantIndex = messages.findLastIndex(
    (message) => message.role === 'assistant',
  )

  if (lastAssistantIndex < 0) {
    return messages
  }

  return messages.map((message, index) =>
    index === lastAssistantIndex ? { ...message, thought: { label } } : message,
  )
}

/**
 * 从后端 thread 快照里还原主聊天消息。
 */
function mapThreadMessages(thread, thoughtSteps) {
  const mapped = thread.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const text = textOfContent(message.content)

      if (message.role === 'user') {
        return {
          id: message.id,
          role: 'user',
          text,
        }
      }

      return {
        id: message.id,
        role: 'assistant',
        paragraphs: [text || ASSISTANT_STREAM_EMPTY_TEXT],
      }
    })

  return attachThoughtToLastAssistant(mapped, thoughtSteps)
}

/**
 * 从后端 thread 快照里还原可观测/思考历史。
 */
function mapThreadThoughtSteps(thread) {
  return thread.messages.flatMap((message) => {
    if (message.role === 'thinking') {
      return [
        createThoughtStep(
          `thinking-${message.id}`,
          '模型思考',
          textOfContent(message.content),
        ),
      ]
    }

    if (message.role === 'tool') {
      return [
        createThoughtStep(
          `tool-${message.id}`,
          `工具结果：${message.name ?? message.toolCallId ?? 'unknown_tool'}`,
          textOfContent(message.content),
          'done',
        ),
      ]
    }

    if (message.role === 'assistant' && Array.isArray(message.toolCalls)) {
      return message.toolCalls.map((toolCall) =>
        createThoughtStep(
          `tool-call-${message.id}-${toolCall.id}`,
          `请求工具：${toolCall.name}`,
          toolCall.argumentsText,
        ),
      )
    }

    return []
  })
}

/**
 * 按更新时间倒序排列 thread，让最近对话显示在最上面。
 */
function sortThreads(threads) {
  return [...threads].sort((left, right) => right.updatedAt - left.updatedAt)
}

/**
 * 根据搜索词过滤 thread。
 *
 * 搜索范围：
 * - thread 标题。
 * - thread 里已有 user/assistant 消息文本。
 */
function filterThreads(threads, query) {
  const keyword = query.trim().toLowerCase()

  if (keyword.length === 0) {
    return threads
  }

  return threads.filter((thread) => {
    const title = String(thread.title ?? '').toLowerCase()
    const messageText = (thread.messages ?? [])
      .map((message) => textOfContent(message.content))
      .join('\n')
      .toLowerCase()

    return title.includes(keyword) || messageText.includes(keyword)
  })
}

/**
 * 用用户输入提前生成侧栏标题，避免必须等 run 完成才能看到历史名称变化。
 */
function createOptimisticTitle(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()

  if (normalized.length === 0) {
    return '新的会话'
  }

  return normalized.length > 30 ? `${normalized.slice(0, 30)}...` : normalized
}

/**
 * SimpAgent 聊天状态 hook。
 */
export function useSimpAgentChat() {
  const [threads, setThreads] = useState([])
  const [activeThreadId, setActiveThreadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [thoughtSteps, setThoughtSteps] = useState([])
  const [pendingApprovals, setPendingApprovals] = useState([])
  const [runStatus, setRunStatus] = useState('loading')
  const [searchQuery, setSearchQuery] = useState('')
  const [composerHelp, setComposerHelp] = useState({
    text: '正在连接 SimpAgent 后端...',
    tone: 'normal',
  })

  // 保存当前 EventSource 的关闭函数，切换 thread 或组件卸载时必须关闭。
  const closeEventsRef = useRef(null)
  // 保存当前流式助手消息 id，SSE token 到达时只更新这一条消息。
  const streamingAssistantIdRef = useRef(null)
  // 保存当前 run id，工具审批按钮需要带着 runId 回填后端。
  const activeRunIdRef = useRef(null)
  // 保存当前状态，避免 EventSource 正常关闭后 onerror 把 done 误判为失败。
  const runStatusRef = useRef(runStatus)
  // 保存最新思考步骤，run done 后刷新 thread 快照时用于保留本轮 live trace/tool 记录。
  const thoughtStepsRef = useRef(thoughtSteps)

  useEffect(() => {
    runStatusRef.current = runStatus
  }, [runStatus])

  useEffect(() => {
    thoughtStepsRef.current = thoughtSteps
  }, [thoughtSteps])

  const visibleThreads = useMemo(
    () => filterThreads(threads, searchQuery),
    [threads, searchQuery],
  )

  /**
   * 用后端 thread 快照刷新当前前端状态。
   */
  const applyThreadSnapshot = useCallback((thread) => {
    const steps = mapThreadThoughtSteps(thread)
    setActiveThreadId(thread.id)
    setThoughtSteps(steps)
    setMessages(mapThreadMessages(thread, steps))
    setThreads((currentThreads) => {
      const others = currentThreads.filter((item) => item.id !== thread.id)
      return sortThreads([thread, ...others])
    })
  }, [])

  /**
   * 重新读取当前 thread，常用于 run done 后和后端最终快照对齐。
   */
  const refreshActiveThread = useCallback(async (options = {}) => {
    if (activeThreadId === null) {
      return
    }

    const thread = await getThread(activeThreadId)

    if (options.preserveLiveThoughtSteps) {
      const steps = thoughtStepsRef.current
      setActiveThreadId(thread.id)
      setMessages(mapThreadMessages(thread, steps))
      setThreads((currentThreads) => {
        const others = currentThreads.filter((item) => item.id !== thread.id)
        return sortThreads([thread, ...others])
      })
      return
    }

    applyThreadSnapshot(thread)
  }, [activeThreadId, applyThreadSnapshot])

  /**
   * 首次进入页面时加载 thread 列表；如果没有历史，则自动创建一个空 thread。
   */
  useEffect(() => {
    let isCancelled = false

    async function bootstrap() {
      try {
        const loadedThreads = sortThreads(await listThreads())

        if (isCancelled) {
          return
        }

        if (loadedThreads.length === 0) {
          const thread = await createThread()

          if (isCancelled) {
            return
          }

          setThreads([thread])
          setActiveThreadId(thread.id)
          setMessages([])
          setThoughtSteps([])
        } else {
          const firstThread = loadedThreads[0]
          setThreads(loadedThreads)
          applyThreadSnapshot(await getThread(firstThread.id))
        }

        setRunStatus('idle')
        setComposerHelp({ text: DEFAULT_HELP_TEXT, tone: 'normal' })
      } catch (error) {
        if (isCancelled) {
          return
        }

        setRunStatus('error')
        setComposerHelp({
          text: `连接后端失败：${error instanceof Error ? error.message : String(error)}`,
          tone: 'error',
        })
      }
    }

    void bootstrap()

    return () => {
      isCancelled = true
      closeEventsRef.current?.()
    }
  }, [applyThreadSnapshot])

  /**
   * 创建新聊天。
   */
  const handleNewChat = useCallback(async () => {
    closeEventsRef.current?.()
    closeEventsRef.current = null
    streamingAssistantIdRef.current = null
    activeRunIdRef.current = null

    try {
      setRunStatus('loading')
      const thread = await createThread()
      setThreads((currentThreads) => sortThreads([thread, ...currentThreads]))
      setActiveThreadId(thread.id)
      setMessages([])
      setThoughtSteps([])
      setPendingApprovals([])
      setComposerHelp({ text: DEFAULT_HELP_TEXT, tone: 'normal' })
      setRunStatus('idle')
    } catch (error) {
      setRunStatus('error')
      setComposerHelp({
        text: `创建新聊天失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }, [])

  /**
   * 选择历史 thread。
   */
  const handleSelectThread = useCallback(
    async (threadId) => {
      closeEventsRef.current?.()
      closeEventsRef.current = null
      streamingAssistantIdRef.current = null
      activeRunIdRef.current = null

      try {
        setRunStatus('loading')
        applyThreadSnapshot(await getThread(threadId))
        setPendingApprovals([])
        setComposerHelp({ text: DEFAULT_HELP_TEXT, tone: 'normal' })
        setRunStatus('idle')
      } catch (error) {
        setRunStatus('error')
        setComposerHelp({
          text: `读取会话失败：${error instanceof Error ? error.message : String(error)}`,
          tone: 'error',
        })
      }
    },
    [applyThreadSnapshot],
  )

  /**
   * 更新当前流式助手消息的正文。
   */
  const appendAssistantDelta = useCallback((delta) => {
    const assistantId = streamingAssistantIdRef.current

    if (assistantId === null) {
      return
    }

    setMessages((currentMessages) =>
      currentMessages.map((message) => {
        if (message.id !== assistantId) {
          return message
        }

        const currentText =
          message.paragraphs?.[0] === ASSISTANT_STREAM_EMPTY_TEXT
            ? ''
            : (message.paragraphs?.[0] ?? '')

        return {
          ...message,
          paragraphs: [`${currentText}${delta}`],
        }
      }),
    )
  }, [])

  /**
   * 把 SSE 事件追加到思考面板。
   */
  const appendThoughtStep = useCallback((step) => {
    setThoughtSteps((currentSteps) => {
      const nextSteps = [...currentSteps, step]
      setMessages((currentMessages) =>
        attachThoughtToLastAssistant(currentMessages, nextSteps),
      )
      return nextSteps
    })
  }, [])

  /**
   * 处理后端 SSE 事件。
   */
  const handleRunEvent = useCallback(
    (event) => {
      if (event.type === 'message_delta') {
        appendAssistantDelta(event.delta)
        return
      }

      if (event.type === 'thinking_delta') {
        appendThoughtStep(
          createThoughtStep(
            `thinking-${event.turnId}-${Date.now()}`,
            '模型思考',
            event.delta,
          ),
        )
        return
      }

      if (event.type === 'tool_call') {
        appendThoughtStep(
          createThoughtStep(
            `tool-call-${event.toolCall.id}`,
            `请求工具：${event.toolCall.name}`,
            event.toolCall.argumentsText,
          ),
        )
        return
      }

      if (event.type === 'tool_approval_requested') {
        const approval = {
          runId: activeRunIdRef.current,
          toolCallId: event.request.toolCall.id,
          toolName: event.request.toolCall.name,
          argumentsText: event.request.toolCall.argumentsText,
          riskSummary: event.request.riskSummary,
          status: 'pending',
        }

        setPendingApprovals((currentApprovals) => [
          ...currentApprovals.filter(
            (item) => item.toolCallId !== approval.toolCallId,
          ),
          approval,
        ])
        setRunStatus('waiting_for_tool_approval')
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === streamingAssistantIdRef.current
              ? {
                  ...message,
                  tools: [
                    ...(message.tools ?? []).filter(
                      (tool) => tool.id !== approval.toolCallId,
                    ),
                    {
                      id: approval.toolCallId,
                      name: approval.toolName,
                      status: approval.status,
                      riskSummary: approval.riskSummary,
                      argumentsText: approval.argumentsText,
                    },
                  ],
                }
              : message,
          ),
        )
        appendThoughtStep(
          createThoughtStep(
            `approval-${approval.toolCallId}`,
            `等待审批：${approval.toolName}`,
            approval.riskSummary,
          ),
        )
        return
      }

      if (event.type === 'tool_result') {
        setRunStatus('running')
        setPendingApprovals((currentApprovals) =>
          currentApprovals.map((approval) =>
            approval.toolCallId === event.toolCallId
              ? {
                  ...approval,
                  status: event.result.ok ? 'approved' : 'failed',
                }
              : approval,
          ),
        )
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === streamingAssistantIdRef.current
              ? {
                  ...message,
                  tools: (message.tools ?? []).map((tool) =>
                    tool.id === event.toolCallId
                      ? {
                          ...tool,
                          status: event.result.ok ? 'done' : 'failed',
                        }
                      : tool,
                  ),
                }
              : message,
          ),
        )
        appendThoughtStep(
          createThoughtStep(
            `tool-result-${event.toolCallId}`,
            `工具结果：${event.toolCallId}`,
            JSON.stringify(event.result.content, null, 2),
            event.result.ok ? 'done' : 'error',
          ),
        )
        return
      }

      if (event.type === 'trace_snapshot') {
        appendThoughtStep(
          createThoughtStep(
            `trace-${event.turnId}`,
            'Trace 快照',
            `请求轮次：${event.trace?.metrics?.requestCount ?? '未知'}`,
            'done',
          ),
        )
        return
      }

      if (event.type === 'error') {
        setRunStatus('error')
        setComposerHelp({ text: `运行失败：${event.message}`, tone: 'error' })
        appendThoughtStep(
          createThoughtStep(
            `error-${event.turnId ?? Date.now()}`,
            `运行错误：${event.errorCode}`,
            event.message,
            'error',
          ),
        )
        closeEventsRef.current?.()
        closeEventsRef.current = null
        return
      }

      if (event.type === 'done') {
        setRunStatus('idle')
        setComposerHelp({ text: DEFAULT_HELP_TEXT, tone: 'normal' })
        closeEventsRef.current?.()
        closeEventsRef.current = null
        streamingAssistantIdRef.current = null
        activeRunIdRef.current = null
        void refreshActiveThread({ preserveLiveThoughtSteps: true })
      }
    },
    [
      appendAssistantDelta,
      appendThoughtStep,
      refreshActiveThread,
    ],
  )

  /**
   * 发送用户消息。
   */
  const handleSendMessage = useCallback(
    async (text, options = {}) => {
      if (runStatus === 'running' || runStatus === 'waiting_for_tool_approval') {
        setComposerHelp({
          text: '当前回复还在进行中，请等待完成后再发送下一条。',
          tone: 'error',
        })
        return
      }

      try {
        const thread =
          activeThreadId === null ? await createThread() : { id: activeThreadId }

        if (activeThreadId === null) {
          setThreads((currentThreads) => sortThreads([thread, ...currentThreads]))
          setActiveThreadId(thread.id)
        }

        setRunStatus('running')
        setComposerHelp({ text: 'SimpAgent 正在生成回复...', tone: 'normal' })
        setThoughtSteps([])
        setPendingApprovals([])
        setThreads((currentThreads) =>
          currentThreads.map((item) =>
            item.id === thread.id && item.title === '新的会话'
              ? { ...item, title: createOptimisticTitle(text) }
              : item,
          ),
        )
        const visibleAttachments = (options.files ?? []).map((file, index) => ({
          id: file.id ?? `attachment-${Date.now()}-${index}`,
          filename: file.filename ?? file.name ?? '未命名附件',
          mediaType: file.mediaType ?? file.type ?? 'application/octet-stream',
          type: file.type ?? 'file',
          url: file.url,
        }))

        setMessages((currentMessages) => [
          ...currentMessages,
          {
            id: `user-local-${Date.now()}`,
            role: 'user',
            text,
            attachments: visibleAttachments,
          },
        ])

        if (visibleAttachments.length > 0) {
          setComposerHelp({
            text: '附件已在前端展示；当前后端接口暂未接收附件正文，本次只发送文本。',
            tone: 'normal',
          })
        }

        const run = await startRun(thread.id, text, {
          model: options.model,
        })
        const assistantId = `assistant-stream-${run.turnId}`
        streamingAssistantIdRef.current = assistantId
        activeRunIdRef.current = run.runId

        setMessages((currentMessages) => [
          ...currentMessages,
          {
            id: assistantId,
            role: 'assistant',
            paragraphs: [ASSISTANT_STREAM_EMPTY_TEXT],
          },
        ])

        closeEventsRef.current?.()
        closeEventsRef.current = openRunEvents(run.runId, {
          onEvent: handleRunEvent,
          onError: () => {
            if (
              runStatusRef.current !== 'idle' &&
              runStatusRef.current !== 'error'
            ) {
              setRunStatus('error')
              setComposerHelp({
                text: 'SSE 连接中断，请检查后端服务是否仍在运行。',
                tone: 'error',
              })
            }
          },
        })
      } catch (error) {
        setRunStatus('error')
        setComposerHelp({
          text: `发送失败：${error instanceof Error ? error.message : String(error)}`,
          tone: 'error',
        })
      }
    },
    [activeThreadId, handleRunEvent, runStatus],
  )

  /**
   * 空输入不会请求后端，只更新提示。
   */
  const handleEmptySubmit = useCallback(() => {
    setComposerHelp({
      text: '请先输入内容，再发送消息。',
      tone: 'error',
    })
  }, [])

  /**
   * 用户继续输入后恢复普通帮助提示。
   */
  const handleComposerInput = useCallback(() => {
    if (runStatus === 'idle') {
      setComposerHelp({ text: DEFAULT_HELP_TEXT, tone: 'normal' })
    }
  }, [runStatus])

  /**
   * 提交工具审批。
   */
  const handleToolApproval = useCallback(async (toolCallId, decision) => {
    const approval = pendingApprovals.find(
      (item) => item.toolCallId === toolCallId,
    )

    if (approval?.runId === null || approval?.runId === undefined) {
      setComposerHelp({ text: '找不到当前 run，无法提交工具审批。', tone: 'error' })
      return
    }

    try {
      await submitToolApproval(
        approval.runId,
        toolCallId,
        decision,
        decision === 'approve' ? '用户允许执行工具。' : '用户拒绝执行工具。',
      )
      setRunStatus('running')
      setPendingApprovals((currentApprovals) =>
        currentApprovals.map((item) =>
          item.toolCallId === toolCallId
            ? {
                ...item,
                status: decision === 'approve' ? 'approved' : 'denied',
              }
            : item,
        ),
      )
      setMessages((currentMessages) =>
        currentMessages.map((message) => ({
          ...message,
          tools: (message.tools ?? []).map((tool) =>
            tool.id === toolCallId
              ? {
                  ...tool,
                  status: decision === 'approve' ? 'approved' : 'denied',
                }
              : tool,
          ),
        })),
      )
      appendThoughtStep(
        createThoughtStep(
          `approval-result-${toolCallId}`,
          decision === 'approve' ? '已允许工具执行' : '已拒绝工具执行',
          toolCallId,
          decision === 'approve' ? 'done' : 'error',
        ),
      )
    } catch (error) {
      setComposerHelp({
        text: `提交审批失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }, [appendThoughtStep, pendingApprovals])

  return {
    threads,
    visibleThreads,
    activeThreadId,
    messages,
    thoughtSteps,
    pendingApprovals,
    runStatus,
    searchQuery,
    composerHelp,
    isBusy: runStatus === 'loading' || runStatus === 'running',
    isWaitingForApproval: runStatus === 'waiting_for_tool_approval',
    setSearchQuery,
    onNewChat: handleNewChat,
    onSelectThread: handleSelectThread,
    onSendMessage: handleSendMessage,
    onEmptySubmit: handleEmptySubmit,
    onComposerInput: handleComposerInput,
    onToolApproval: handleToolApproval,
  }
}
