/*
 * 文件作用：
 * 这个文件用真实 Chromium 验证 React 版 SimpChat 接入后端后的关键行为。
 *
 * 测试原则：
 * 1. 后端 HTTP API 用 Playwright route mock，避免依赖真实模型配置和 API key。
 * 2. SSE 用浏览器内 Mock EventSource，覆盖前端事件映射逻辑。
 * 3. 继续保留桌面、移动端、中文输入法组合态、无横向溢出和浏览器错误检查。
 */

import { expect, test } from '@playwright/test'

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

async function dispatchMockSse(page, type, data) {
  await page.evaluate(
    ({ eventType, eventData }) => {
      const source = window.__simpagentEventSources.at(-1)
      source.dispatch(eventType, eventData)
    },
    { eventType: type, eventData: data },
  )
}

async function setupMockBackend(page, options = {}) {
  const thread = createThread(options.thread)
  const threads = [thread]
  const approvals = []
  let nextThreadNumber = 2
  let nextRunNumber = 1

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api/, '')
    const method = request.method()

    if (path === '/conversations' && method === 'GET') {
      await route.fulfill({ json: threads })
      return
    }

    if (path === '/conversations' && method === 'POST') {
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

    const runMatch = path.match(/^\/conversations\/([^/]+)\/runs$/)

    if (runMatch && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}')
      const currentThread = threads.find((item) => item.id === runMatch[1])
      const runId = `run_${nextRunNumber}`
      const turnId = `turn_${nextRunNumber}`
      nextRunNumber += 1

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

    const threadMatch = path.match(/^\/conversations\/([^/]+)$/)

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

  return { threads, approvals }
}

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

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))

  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)
}

async function expectSpriteIconsLoaded(page) {
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('use')).map((use) =>
      use.getAttribute('href'),
    ),
  )

  const spriteText = await page.evaluate(async () => {
    const response = await fetch('/icons.svg')
    return response.text()
  })

  const expectedIds = [
    '6be74c',
    '127a53',
    '23ce94',
    'ba3792',
    '29f921',
    '01bab7',
    '55180d',
    '836f7a',
    '3a5c87',
    'ac6d36',
    '003104',
    'b140e7',
    '6b0d8c',
    'a4763e',
    '38e54b',
    '630ca2',
    'f6d0e2',
    'ce3544',
    '6d87e1',
  ]

  for (const id of expectedIds) {
    expect(spriteText, `icons.svg 应该包含 symbol: ${id}`).toContain(
      `id="${id}"`,
    )
  }

  for (const href of hrefs) {
    expect(href, 'React 版图标应该统一引用 public/icons.svg').toMatch(
      /^\/icons\.svg#/,
    )
  }
}

async function expectComposerFocusStyleIsClean(page, editor) {
  const surface = page.locator('.composer-surface-local')
  const initialSurfaceBoxShadow = await surface.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  )

  await editor.focus()
  await editor.fill('焦点视觉检查')

  await expect(editor).toHaveCSS('outline-style', 'none')
  await expect(editor).toHaveCSS('box-shadow', 'none')

  const focusStyles = await page.evaluate(() => {
    const surfaceElement = document.querySelector('.composer-surface-local')
    const editorElement = document.querySelector('#prompt-textarea')

    return {
      surfaceBoxShadow: getComputedStyle(surfaceElement).boxShadow,
      editorBoxShadow: getComputedStyle(editorElement).boxShadow,
    }
  })

  expect(focusStyles.surfaceBoxShadow).toBe(initialSurfaceBoxShadow)
  expect(focusStyles.surfaceBoxShadow).not.toContain('15, 143, 112')
  expect(focusStyles.editorBoxShadow).toBe('none')
  expect(focusStyles.editorBoxShadow).not.toContain('0, 79, 153')

  await editor.fill('')
}

test('桌面端可以加载真实 thread、搜索历史、发送并渲染 SSE 流式输出', async ({
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
  await setupMockBackend(page)
  const errors = await collectBrowserErrors(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  await expect(page).toHaveTitle(/SimpChat/)
  await expect(page.getByLabel('聊天侧栏')).toBeVisible()
  await expect(page.getByRole('button', { name: '选择模型' })).toBeVisible()
  await expect(page.locator('.assistant-content').first()).toContainText(
    '历史后端回复',
  )

  const editor = page.getByRole('textbox', { name: '与 ChatGPT 聊天' })
  await expect(editor).toBeVisible()
  await expect(page.getByLabel('发送提示')).toBeDisabled()

  await expectComposerFocusStyleIsClean(page, editor)
  await expectSpriteIconsLoaded(page)
  await expectNoHorizontalOverflow(page)

  await page.getByLabel('打开边栏').click()
  await page.getByLabel('搜索聊天').fill('骰子')
  await expect(page.locator('#sidebar')).toContainText('骰子概率分析')

  await page.getByLabel('查看思考过程').click()
  await expect(page.locator('#thought-panel')).toHaveAttribute(
    'data-open',
    'true',
  )
  await expect(page.locator('#thought-panel')).toContainText('历史思考条目')
  await page.getByLabel('关闭思考详情').click()

  const userBubbleCountBefore = await page.locator('.user-bubble').count()

  await editor.press('Enter')
  await expect(page.locator('#composer-help')).toContainText('请先输入内容')
  await expect(page.locator('.user-bubble')).toHaveCount(userBubbleCountBefore)

  await editor.fill('第一行')
  await editor.press('Shift+Enter')
  await editor.type('第二行')
  await expect(editor).toHaveValue('第一行\n第二行')

  await editor.press('Enter')
  await expect(page.locator('.user-bubble')).toHaveCount(
    userBubbleCountBefore + 1,
  )
  await expect(page.locator('.assistant-content').last()).toContainText(
    '流式你好',
  )
  await expect(page.locator('#composer-help')).toContainText(
    'Enter 发送',
  )
  await expect(editor).toHaveValue('')

  await page.getByLabel('查看思考过程').last().click()
  await expect(page.locator('#thought-panel')).toContainText('Trace 快照')

  await page.screenshot({
    path: testInfo.outputPath('simpchat-desktop.png'),
    fullPage: true,
  })

  expect(errors).toEqual([])
})

test('工具审批按钮会回填后端并把工具结果写入思考面板', async ({ page }) => {
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
  })
  const backend = await setupMockBackend(page)
  const errors = await collectBrowserErrors(page)

  await page.goto('/')
  const editor = page.getByRole('textbox', { name: '与 ChatGPT 聊天' })
  await editor.fill('读取 README')
  await editor.press('Enter')

  await expect(page.getByLabel('工具审批：read_file')).toBeVisible()
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

  await page.getByLabel('查看思考过程').last().click()
  await expect(page.locator('#thought-panel')).toContainText('工具结果')
  await expect(page.locator('#thought-panel')).toContainText('README 内容')
  expect(errors).toEqual([])
})

test('移动端侧栏、新聊天、遮罩关闭和无横向溢出都可用', async ({
  page,
}, testInfo) => {
  await installMockEventSource(page, {})
  await setupMockBackend(page)
  const errors = await collectBrowserErrors(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expectNoHorizontalOverflow(page)

  await page.getByLabel('打开侧栏').click()
  await expect(page.locator('#sidebar')).toHaveAttribute('data-open', 'true')
  await expect(page.locator('#mobile-sidebar-overlay')).toHaveAttribute(
    'data-open',
    'true',
  )

  await page
    .locator('#mobile-sidebar-overlay')
    .click({ position: { x: 380, y: 200 } })
  await expect(page.locator('#sidebar')).toHaveAttribute('data-open', 'false')

  await page.getByLabel('打开侧栏').click()
  await page.locator('#sidebar').getByLabel('新聊天').click()
  await expect(page.locator('#sidebar')).toHaveAttribute('data-open', 'false')
  await expect(page.locator('.assistant-content')).toHaveCount(0)
  await expect(page.getByLabel('发送提示')).toBeDisabled()

  await expectNoHorizontalOverflow(page)

  await page.screenshot({
    path: testInfo.outputPath('simpchat-mobile.png'),
    fullPage: true,
  })

  expect(errors).toEqual([])
})

test('中文输入法组合态按 Enter 不会误发送消息', async ({ page }) => {
  await installMockEventSource(page, {})
  await setupMockBackend(page)
  const errors = await collectBrowserErrors(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const editor = page.getByRole('textbox', { name: '与 ChatGPT 聊天' })
  await expect(page.locator('.assistant-content').first()).toContainText(
    '历史后端回复',
  )
  const userBubbleCountBefore = await page.locator('.user-bubble').count()

  await editor.fill('拼音输入中')
  await editor.dispatchEvent('compositionstart')
  await editor.press('Enter')
  await editor.dispatchEvent('compositionend')

  await expect(page.locator('.user-bubble')).toHaveCount(userBubbleCountBefore)
  await expect(editor).toHaveValue(/拼音输入中/)

  expect(errors).toEqual([])
})
