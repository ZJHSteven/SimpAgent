/*
 * 文件作用：
 * 这个文件用真实 Chromium 验证 AI Elements 重构后的 SimpChat 前端。
 *
 * 测试原则：
 * 1. 后端 HTTP API 用 Playwright route mock，避免测试依赖真实模型、真实 API key 和本机后端。
 * 2. SSE 用浏览器内 Mock EventSource，覆盖前端把 run 事件映射成消息、思考步骤和工具审批的逻辑。
 * 3. 断言尽量使用 role、可访问名称和用户可见文本，不再绑定旧 ChatGPT 复刻 CSS class。
 * 4. 每个测试都会收集 console.error/pageerror，确保不是“看起来通过但浏览器已经报错”。
 */

import { expect, test } from '@playwright/test'

/**
 * 构造一个最小 thread 快照。
 *
 * 输入：
 * - overrides: 用于覆盖默认字段，方便每个测试构造不同历史。
 *
 * 输出：
 * - 与后端 thread API 相同形状的对象。
 */
function createThread(overrides = {}) {
  return {
    id: overrides.id ?? 'thread_1',
    agentId: 'agent_default',
    title: overrides.title ?? '骰子概率分析',
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
    messages:
      overrides.messages ?? [
        {
          id: 'msg_user_1',
          role: 'user',
          content: '历史问题',
        },
        {
          id: 'msg_assistant_1',
          role: 'assistant',
          content: '历史后端回复',
        },
        {
          id: 'msg_thinking_1',
          role: 'thinking',
          content: '历史思考条目',
        },
      ],
    ...overrides,
  }
}

/**
 * 在浏览器页面里安装一个假的 EventSource。
 *
 * 输入：
 * - page: 当前 Playwright 页面。
 * - eventsByRunId: 按 runId 分组的 SSE 事件列表。
 *
 * 核心逻辑：
 * - 前端打开 /runs/:runId/events 时，MockEventSource 会按 runId 找到预置事件并异步派发。
 * - 测试也可以通过 dispatchMockSse 往最后一个 EventSource 继续塞事件。
 */
async function installMockEventSource(page, eventsByRunId) {
  await page.addInitScript((mockEventsByRunId) => {
    window.__simpagentEventSources = []

    class MockEventSource {
      constructor(url) {
        this.url = url
        this.listeners = new Map()
        this.closed = false
        window.__simpagentEventSources.push(this)

        const runId = String(url).match(/\/runs\/([^/]+)\/events/)?.[1]
        const events = mockEventsByRunId[runId] ?? []

        setTimeout(() => {
          for (const event of events) {
            this.dispatch(event.type, event)
          }
        }, 20)
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? []
        listeners.push(listener)
        this.listeners.set(type, listeners)
      }

      dispatch(type, data) {
        if (this.closed) {
          return
        }

        const listeners = this.listeners.get(type) ?? []
        const event = new MessageEvent(type, {
          data: JSON.stringify(data),
        })

        for (const listener of listeners) {
          listener(event)
        }
      }

      close() {
        this.closed = true
      }
    }

    window.EventSource = MockEventSource
  }, eventsByRunId)
}

/**
 * 给最后一个 Mock EventSource 手动派发事件。
 */
async function dispatchMockSse(page, type, data) {
  await page.evaluate(
    ({ eventType, eventData }) => {
      const source = window.__simpagentEventSources.at(-1)
      source.dispatch(eventType, eventData)
    },
    { eventType: type, eventData: data },
  )
}

/**
 * 安装前端所需的所有后端 API mock。
 *
 * 输出：
 * - threads: 当前 mock 维护的 thread 列表，便于测试调试。
 * - approvals: 工具审批提交记录。
 * - runBodies: 每次 startRun 的请求体，用来验证模型选择等前端参数。
 */
async function setupMockBackend(page, options = {}) {
  const thread = createThread(options.thread)
  const threads = [thread]
  const approvals = []
  const runBodies = []
  let nextThreadNumber = 2
  let nextRunNumber = 1

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api/, '')
    const method = request.method()

    if (path === '/threads' && method === 'GET') {
      await route.fulfill({ json: threads })
      return
    }

    if (path === '/threads' && method === 'POST') {
      const nextThread = createThread({
        id: `thread_${nextThreadNumber}`,
        title: '新的会话',
        createdAt: nextThreadNumber,
        updatedAt: nextThreadNumber,
        messages: [],
      })
      nextThreadNumber += 1
      threads.unshift(nextThread)
      await route.fulfill({ status: 201, json: nextThread })
      return
    }

    const runMatch = path.match(/^\/threads\/([^/]+)\/runs$/)

    if (runMatch && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}')
      const currentThread = threads.find((item) => item.id === runMatch[1])
      const runId = `run_${nextRunNumber}`
      const turnId = `turn_${nextRunNumber}`
      nextRunNumber += 1
      runBodies.push({ threadId: runMatch[1], body })

      if (currentThread) {
        currentThread.title =
          currentThread.title === '新的会话'
            ? String(body.input).slice(0, 30)
            : currentThread.title
        currentThread.messages = [
          ...currentThread.messages,
          {
            id: `msg_user_${runId}`,
            role: 'user',
            content: body.input,
          },
          {
            id: `msg_assistant_${runId}`,
            role: 'assistant',
            content: options.finalAssistantText ?? '流式你好',
          },
          {
            id: `msg_tool_${runId}`,
            role: 'tool',
            name: 'read_file',
            toolCallId: 'call_read_file',
            content: '{"ok":true}',
          },
        ]
        currentThread.updatedAt += 10
      }

      await route.fulfill({
        status: 202,
        json: { runId, turnId },
      })
      return
    }

    const threadMatch = path.match(/^\/threads\/([^/]+)$/)

    if (threadMatch && method === 'GET') {
      const currentThread = threads.find((item) => item.id === threadMatch[1])
      await route.fulfill({
        status: currentThread ? 200 : 404,
        json: currentThread ?? {
          ok: false,
          errorCode: 'NOT_FOUND',
          message: 'thread 不存在',
        },
      })
      return
    }

    const approvalMatch = path.match(
      /^\/runs\/([^/]+)\/tool-approvals\/([^/]+)$/,
    )

    if (approvalMatch && method === 'POST') {
      approvals.push({
        runId: approvalMatch[1],
        toolCallId: approvalMatch[2],
        body: JSON.parse(request.postData() || '{}'),
      })
      await route.fulfill({ json: { ok: true } })
      return
    }

    await route.fulfill({
      status: 404,
      json: { ok: false, errorCode: 'NOT_FOUND', message: '未 mock 的接口' },
    })
  })

  return { threads, approvals, runBodies }
}

/**
 * 收集浏览器错误。
 *
 * 注意：
 * - Playwright 自己的断言失败不会进这里。
 * - 这里专门抓页面运行时错误和 console.error。
 */
async function collectBrowserErrors(page) {
  const errors = []

  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`)
  })

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console.error: ${message.text()}`)
    }
  })

  return errors
}

/**
 * 验证页面没有横向溢出。
 */
async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))

  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)
}

test('桌面端可以加载历史、搜索、选择模型、发送并渲染 SSE 输出', async ({
  page,
}, testInfo) => {
  await installMockEventSource(page, {
    run_1: [
      { type: 'run_started', threadId: 'thread_1', turnId: 'turn_1', runId: 'run_1' },
      { type: 'thinking_delta', threadId: 'thread_1', turnId: 'turn_1', delta: '正在判断工具需求' },
      { type: 'message_delta', threadId: 'thread_1', turnId: 'turn_1', delta: '流式' },
      { type: 'message_delta', threadId: 'thread_1', turnId: 'turn_1', delta: '你好' },
      {
        type: 'trace_snapshot',
        threadId: 'thread_1',
        turnId: 'turn_1',
        trace: { metrics: { requestCount: 1 } },
      },
      { type: 'done', threadId: 'thread_1', turnId: 'turn_1', runId: 'run_1' },
    ],
  })
  const backend = await setupMockBackend(page)
  const errors = await collectBrowserErrors(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  await expect(page).toHaveTitle(/SimpChat/)
  await expect(page.getByRole('button', { name: '选择模型' })).toContainText(
    'GPT-4o',
  )
  await expect(page.getByRole('log')).toContainText('历史后端回复')
  await expect(page.getByRole('button', { name: '已思考 1 项' })).toBeVisible()

  const editor = page.getByRole('textbox', { name: '消息输入框' })
  await expect(editor).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled()
  await expectNoHorizontalOverflow(page)

  await page.getByLabel('搜索聊天').fill('骰子')
  await expect(page.getByRole('button', { name: /骰子概率分析/ })).toBeVisible()

  await page.getByRole('button', { name: '选择模型' }).click()
  await page.getByText('DeepSeek Chat').click()
  await expect(
    page.getByRole('option', { name: 'DeepSeek Chat DeepSeek' }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '选择模型' })).toContainText(
    'DeepSeek Chat',
  )

  await page.getByRole('button', { name: '已思考 1 项' }).click()
  await expect(page.getByLabel('思考详情')).toContainText('历史思考条目')
  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByLabel('思考详情')).toHaveCount(0)

  await editor.press('Enter')
  await expect(page.getByText('Enter 发送')).toBeVisible()
  expect(backend.runBodies).toHaveLength(0)

  await editor.fill('第一行')
  await editor.press('Shift+Enter')
  await editor.type('第二行')
  await expect(editor).toHaveValue('第一行\n第二行')

  await editor.press('Enter')
  await expect(page.getByRole('log')).toContainText('流式你好')
  await expect(page.getByText('Enter 发送')).toBeVisible()
  await expect(editor).toHaveValue('')
  expect(backend.runBodies).toEqual([
    expect.objectContaining({
      body: expect.objectContaining({
        input: '第一行\n第二行',
        model: 'deepseek-chat',
      }),
    }),
  ])

  await page.getByRole('button', { name: /已思考/ }).last().click()
  await expect(page.getByLabel('思考详情')).toContainText('Trace 快照')

  await page.getByRole('button', { name: 'Graph' }).click()
  await expect(page.getByRole('heading', { name: 'Graph' })).toBeVisible()
  await expect(page.getByText('Agent Loop')).toBeVisible()

  await page.screenshot({
    path: testInfo.outputPath('simpchat-desktop.png'),
    fullPage: true,
  })

  expect(errors).toEqual([])
})

test('工具审批允许和拒绝都会回填后端并写入思考面板', async ({ page }) => {
  await installMockEventSource(page, {
    run_1: [
      { type: 'run_started', threadId: 'thread_1', turnId: 'turn_1', runId: 'run_1' },
      {
        type: 'tool_call',
        threadId: 'thread_1',
        turnId: 'turn_1',
        toolCall: {
          id: 'call_read_file',
          name: 'read_file',
          argumentsText: '{"path":"README.md"}',
        },
      },
      {
        type: 'tool_approval_requested',
        request: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolCall: {
            id: 'call_read_file',
            name: 'read_file',
            argumentsText: '{"path":"README.md"}',
          },
          parsedArguments: { path: 'README.md' },
          riskSummary: '工具 read_file 即将执行。',
        },
      },
    ],
    run_2: [
      { type: 'run_started', threadId: 'thread_1', turnId: 'turn_2', runId: 'run_2' },
      {
        type: 'tool_call',
        threadId: 'thread_1',
        turnId: 'turn_2',
        toolCall: {
          id: 'call_read_file',
          name: 'read_file',
          argumentsText: '{"path":"README.md"}',
        },
      },
      {
        type: 'tool_approval_requested',
        request: {
          threadId: 'thread_1',
          turnId: 'turn_2',
          toolCall: {
            id: 'call_read_file',
            name: 'read_file',
            argumentsText: '{"path":"README.md"}',
          },
          parsedArguments: { path: 'README.md' },
          riskSummary: '工具 read_file 即将执行。',
        },
      },
    ],
  })
  const backend = await setupMockBackend(page)
  const errors = await collectBrowserErrors(page)

  await page.goto('/')
  const editor = page.getByRole('textbox', { name: '消息输入框' })
  await editor.fill('读取 README')
  await editor.press('Enter')

  await expect(page.getByText('工具审批：read_file')).toBeVisible()
  await page.getByRole('button', { name: '允许' }).click()
  expect(backend.approvals).toEqual([
    expect.objectContaining({
      runId: 'run_1',
      toolCallId: 'call_read_file',
      body: expect.objectContaining({ decision: 'approve' }),
    }),
  ])

  await dispatchMockSse(page, 'tool_result', {
    type: 'tool_result',
    threadId: 'thread_1',
    turnId: 'turn_1',
    toolCallId: 'call_read_file',
    result: { ok: true, content: { ok: true, text: 'README 内容' } },
  })
  await dispatchMockSse(page, 'message_delta', {
    type: 'message_delta',
    threadId: 'thread_1',
    turnId: 'turn_1',
    delta: '已读取。',
  })
  await dispatchMockSse(page, 'done', {
    type: 'done',
    threadId: 'thread_1',
    turnId: 'turn_1',
    runId: 'run_1',
  })

  await page.getByRole('button', { name: /已思考/ }).last().click()
  await expect(page.getByLabel('思考详情')).toContainText('工具结果')
  await expect(page.getByLabel('思考详情')).toContainText('README 内容')

  await page.getByRole('button', { name: '关闭' }).click()
  await editor.fill('再次读取')
  await editor.press('Enter')
  await expect(page.getByText('工具审批：read_file')).toBeVisible()
  await page.getByRole('button', { name: '拒绝' }).click()
  expect(backend.approvals).toContainEqual(
    expect.objectContaining({
      runId: 'run_2',
      toolCallId: 'call_read_file',
      body: expect.objectContaining({ decision: 'deny' }),
    }),
  )

  await page.getByRole('button', { name: /已思考/ }).last().click()
  await expect(page.getByLabel('思考详情')).toContainText('已拒绝工具执行')
  expect(errors).toEqual([])
})

test('移动端侧栏、新聊天和无横向溢出都可用', async ({
  page,
}, testInfo) => {
  await installMockEventSource(page, {})
  await setupMockBackend(page)
  const errors = await collectBrowserErrors(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expectNoHorizontalOverflow(page)

  await page.getByLabel('打开或收起侧栏').click()
  const sidebarDialog = page.getByRole('dialog', { name: 'Sidebar' })
  await expect(sidebarDialog).toBeVisible()
  await expect(sidebarDialog.getByRole('button', { name: 'Graph' })).toBeVisible()

  await sidebarDialog.getByLabel('新聊天').click()
  await expect(sidebarDialog).toHaveCount(0)
  await expect(page.getByText('开始一个 SimpAgent 会话')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled()

  await expectNoHorizontalOverflow(page)

  await page.screenshot({
    path: testInfo.outputPath('simpchat-mobile.png'),
    fullPage: true,
  })

  expect(errors).toEqual([])
})

test('中文输入法组合态按 Enter 不会误发送消息', async ({ page }) => {
  await installMockEventSource(page, {})
  const backend = await setupMockBackend(page)
  const errors = await collectBrowserErrors(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const editor = page.getByRole('textbox', { name: '消息输入框' })
  await expect(page.getByRole('log')).toContainText('历史后端回复')

  await editor.fill('拼音输入中')
  await editor.dispatchEvent('compositionstart')
  await editor.press('Enter')
  await editor.dispatchEvent('compositionend')

  await expect(page.getByRole('log')).not.toContainText('流式你好')
  await expect(editor).toHaveValue(/拼音输入中/)
  expect(backend.runBodies).toHaveLength(0)
  expect(errors).toEqual([])
})
