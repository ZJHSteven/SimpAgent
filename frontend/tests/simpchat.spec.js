/*
 * 文件作用：
 * 这个文件用真实浏览器验证 React 版 SimpChat 是否可用。
 *
 * 测试原则：
 * 1. 优先验证用户可见行为，而不是旧 HTML 的内部实现细节。
 * 2. 覆盖桌面、移动端、边界输入、图标 sprite 和基础视觉截图。
 * 3. 浏览器控制台 error 和 pageerror 都视为失败，避免静默白屏。
 */

import { expect, test } from '@playwright/test'

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

test('桌面端聊天界面可以渲染、发送、切换侧栏和打开思考面板', async ({
  page,
}, testInfo) => {
  const errors = await collectBrowserErrors(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  await expect(page).toHaveTitle(/SimpChat/)
  await expect(page.getByLabel('聊天侧栏')).toBeVisible()
  await expect(page.getByRole('button', { name: '选择模型' })).toBeVisible()

  const editor = page.getByRole('textbox', { name: '与 ChatGPT 聊天' })
  await expect(editor).toBeVisible()
  await expect(page.getByLabel('发送提示')).toBeDisabled()

  await editor.focus()
  await expect(editor).toHaveCSS('outline-style', 'none')

  await expectSpriteIconsLoaded(page)
  await expectNoHorizontalOverflow(page)

  await expect(page.locator('#app-shell')).toHaveAttribute(
    'data-sidebar-state',
    'collapsed',
  )
  await page.getByLabel('打开边栏').click()
  await expect(page.locator('#app-shell')).toHaveAttribute(
    'data-sidebar-state',
    'expanded',
  )
  await expect
    .poll(async () => (await page.locator('#sidebar').boundingBox()).width)
    .toBeGreaterThan(200)

  await page.getByLabel('收起边栏').click()
  await expect(page.locator('#app-shell')).toHaveAttribute(
    'data-sidebar-state',
    'collapsed',
  )
  await expect
    .poll(async () => (await page.locator('#sidebar').boundingBox()).width)
    .toBeLessThanOrEqual(70)

  await page.getByLabel('查看思考过程').click()
  await expect(page.locator('#thought-panel')).toHaveAttribute(
    'data-open',
    'true',
  )
  await expect(page.locator('#thought-panel')).toContainText(
    'Searching GitHub for FancySS update temp files',
  )
  await expect(page.getByLabel('查看思考过程')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.getByLabel('关闭思考详情').click()
  await expect(page.locator('#thought-panel')).toHaveAttribute(
    'data-open',
    'false',
  )

  const userBubbleCountBefore = await page.locator('.user-bubble').count()

  await editor.press('Enter')
  await expect(page.locator('#composer-help')).toContainText('请先输入内容')
  await expect(page.locator('.user-bubble')).toHaveCount(userBubbleCountBefore)

  await editor.fill('第一行')
  await editor.press('Shift+Enter')
  await editor.type('第二行')
  await expect(editor).toHaveValue('第一行\n第二行')
  await expect(page.locator('.user-bubble')).toHaveCount(userBubbleCountBefore)

  await editor.press('Enter')
  await expect(page.locator('.user-bubble')).toHaveCount(
    userBubbleCountBefore + 1,
  )
  await expect(page.locator('.assistant-content').last()).toContainText(
    '本地静态演示',
  )
  await expect(editor).toHaveValue('')
  await expect(page.getByLabel('发送提示')).toBeDisabled()

  await page.screenshot({
    path: testInfo.outputPath('simpchat-desktop.png'),
    fullPage: true,
  })

  expect(errors).toEqual([])
})

test('移动端侧栏、新聊天、遮罩关闭和无横向溢出都可用', async ({
  page,
}, testInfo) => {
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
  await expect(page.locator('.assistant-content').first()).toContainText(
    '新的本地会话已创建',
  )
  await expect(page.getByLabel('发送提示')).toBeDisabled()

  await expectNoHorizontalOverflow(page)

  await page.screenshot({
    path: testInfo.outputPath('simpchat-mobile.png'),
    fullPage: true,
  })

  expect(errors).toEqual([])
})

test('中文输入法组合态按 Enter 不会误发送消息', async ({ page }) => {
  const errors = await collectBrowserErrors(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const editor = page.getByRole('textbox', { name: '与 ChatGPT 聊天' })
  const userBubbleCountBefore = await page.locator('.user-bubble').count()

  await editor.fill('拼音输入中')
  await editor.dispatchEvent('compositionstart')
  await editor.press('Enter')
  await editor.dispatchEvent('compositionend')

  await expect(page.locator('.user-bubble')).toHaveCount(userBubbleCountBefore)
  await expect(editor).toHaveValue(/拼音输入中/)

  expect(errors).toEqual([])
})
