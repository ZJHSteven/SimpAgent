/*
 * 文件作用：
 * 这个 Playwright 测试文件用于验证 tem.html 这个本地静态聊天页面是否真的可用。
 *
 * 测试范围：
 * 1. 桌面端基础渲染：标题、侧栏、输入器和本地 sprite 图标都要存在。
 * 2. 输入边界：空输入不发送，Shift + Enter 只换行，Enter 正常发送。
 * 3. 桌面侧栏：宽屏可以在展开态和窄 rail 收起态之间切换。
 * 4. 思考面板：点击“已思考”按钮可以打开右侧思考详情。
 * 5. 移动端布局：侧栏可以打开，新聊天可以重置内容，页面不能横向溢出。
 * 6. 异常监听：浏览器控制台不能出现 error，页面不能抛 pageerror。
 */

// 引入 Playwright Test 的 test 和 expect，用于组织用例和断言结果。
// 运行命令使用：npx --yes --package @playwright/test playwright test tests/chat-ui.spec.js --reporter=line
const { test, expect } = require("@playwright/test");

// 引入 path 模块，用于把本地文件路径转换成稳定的绝对路径。
const path = require("path");

// 当前测试目标是仓库根目录下的 tem.html。
const pagePath = path.resolve(__dirname, "..", "tem.html");

// Windows 路径需要把反斜杠替换为正斜杠，file:// URL 才能被浏览器稳定识别。
const pageUrl = `file:///${pagePath.replace(/\\/g, "/")}`;

// 注册通用的浏览器错误监听，避免页面静默失败。
async function collectBrowserErrors(page) {
  // errors 数组记录 console.error 和 pageerror。
  const errors = [];

  // 监听页面级 JavaScript 异常。
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  // 监听浏览器控制台 error。
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });

  // 返回数组引用，让测试结束时可以统一断言。
  return errors;
}

// 检查页面没有横向溢出，移动端尤其容易出现这个问题。
async function expectNoHorizontalOverflow(page) {
  // 在浏览器上下文中读取视口宽度和文档滚动宽度。
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));

  // 文档宽度最多允许 1 像素误差，避免小数舍入造成假失败。
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);

  // body 宽度同样不应超过视口。
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

// 检查页面中的 SVG use 是否指向从本地 sprite 抽取出的内联 symbol。
async function expectSpriteIconsLoaded(page) {
  // 读取所有 use[href]，确认不再使用手工 data SVG 或会被 file:// 拦截的外部 sprite。
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("use")).map((use) => use.getAttribute("href")),
  );

  // 这些 id 来自用户贴出的原始 DOM 片段，覆盖 composer、侧栏和思考面板。
  const expectedIds = [
    "6be74c",
    "127a53",
    "23ce94",
    "ba3792",
    "29f921",
    "01bab7",
    "55180d",
    "836f7a",
    "3a5c87",
    "ac6d36",
    "003104",
    "b140e7",
    "6b0d8c",
    "a4763e",
  ];

  // 每个关键 symbol 都必须至少出现一次。
  for (const id of expectedIds) {
    expect(
      hrefs.some((href) => href === `#${id}`),
      `应该引用内联原始 symbol: ${id}`,
    ).toBe(true);
  }

  // 所有 sprite 引用都应该指向当前 HTML 内联 symbol，避免 file:// 安全拦截。
  for (const href of hrefs) {
    expect(href, "SVG use 应该引用内联 symbol").toMatch(/^#/);
  }
}

test("桌面端可以渲染核心聊天界面并完成发送流程", async ({ page }) => {
  // 收集页面运行时错误。
  const errors = await collectBrowserErrors(page);

  // 使用桌面常见视口打开本地 HTML。
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pageUrl);

  // 页面标题应该正确。
  await expect(page).toHaveTitle(/SimpChat/);

  // 侧栏在桌面端应该可见。
  await expect(page.getByLabel("聊天侧栏")).toBeVisible();

  // 顶部模型按钮应该可见。
  await expect(page.getByRole("button", { name: "选择模型" })).toBeVisible();

  // 输入框应该使用 ChatGPT 式 contenteditable textbox。
  const editor = page.getByRole("textbox", { name: "与 ChatGPT 聊天" });
  await expect(editor).toBeVisible();

  // 刷新后的 composer 主输入区不应因为 placeholder 被撑得过高。
  const composerPrimaryHeight = await page.locator(".composer-primary").evaluate((node) =>
    Math.round(node.getBoundingClientRect().height),
  );
  expect(composerPrimaryHeight).toBeLessThanOrEqual(64);

  // 页面图标应该引用本地下载的 sprite。
  await expectSpriteIconsLoaded(page);

  // 桌面端不应横向溢出。
  await expectNoHorizontalOverflow(page);

  // 宽屏侧栏展开态应比原先更收紧。
  const expandedSidebarBox = await page.locator("#sidebar").boundingBox();
  expect(expandedSidebarBox.width).toBeLessThanOrEqual(245);

  // 宽屏侧栏可以收起成窄 rail。
  await page.getByLabel("收起边栏").click();
  await expect(page.locator("#app-shell")).toHaveAttribute("data-sidebar-state", "collapsed");
  const collapsedSidebarBox = await page.locator("#sidebar").boundingBox();
  expect(collapsedSidebarBox.width).toBeLessThanOrEqual(70);

  // 再次打开后恢复展开态。
  await page.getByLabel("打开边栏").click();
  await expect(page.locator("#app-shell")).toHaveAttribute("data-sidebar-state", "expanded");

  // 思考按钮可以打开右侧思考面板。
  await page.getByLabel("查看思考过程").click();
  await expect(page.locator("#thought-panel")).toHaveAttribute("data-open", "true");
  await expect(page.locator("#thought-panel")).toContainText("Searching GitHub for FancySS update temp files");
  await page.getByLabel("关闭思考详情").click();
  await expect(page.locator("#thought-panel")).toHaveAttribute("data-open", "false");

  // 空输入按 Enter 应提示错误，且不会新增用户气泡。
  await editor.click();
  await editor.press("Enter");
  await expect(page.locator("#composer-help")).toContainText("请先输入内容");

  // 记录发送前的用户消息数量。
  const userBubbleCountBefore = await page.locator(".user-bubble").count();

  // Shift + Enter 应该换行，不应发送。
  await editor.fill("第一行");
  await editor.press("Shift+Enter");
  await editor.type("第二行");
  await expect(editor).toContainText("第一行");
  await expect(editor).toContainText("第二行");
  await expect(page.locator(".user-bubble")).toHaveCount(userBubbleCountBefore);

  // Enter 应该发送消息，并追加一条本地模拟助手回复。
  await editor.press("Enter");
  await expect(page.locator(".user-bubble")).toHaveCount(userBubbleCountBefore + 1);
  await expect(page.locator(".assistant-content").last()).toContainText("本地静态演示");

  // 发送后输入框应该被清空，发送按钮应该重新禁用。
  await expect(page.locator(".ProseMirror .placeholder")).toBeVisible();
  await expect(page.getByLabel("发送提示")).toBeDisabled();

  // 页面运行过程中不应该有浏览器错误。
  expect(errors).toEqual([]);
});

test("移动端侧栏和新聊天流程可用且无横向溢出", async ({ page }) => {
  // 收集页面运行时错误。
  const errors = await collectBrowserErrors(page);

  // 使用常见手机视口打开页面。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl);

  // 移动端初始不应出现横向溢出。
  await expectNoHorizontalOverflow(page);

  // 打开移动端侧栏。
  await page.getByLabel("打开侧栏").click();
  await expect(page.locator("#sidebar")).toHaveAttribute("data-open", "true");

  // 点击新聊天应重置消息，并收起侧栏。
  await page.getByLabel("新聊天").click();
  await expect(page.locator("#sidebar")).toHaveAttribute("data-open", "false");
  await expect(page.locator(".assistant-content").first()).toContainText("新的本地会话已创建");

  // 重置后依然不应横向溢出。
  await expectNoHorizontalOverflow(page);

  // 页面运行过程中不应该有浏览器错误。
  expect(errors).toEqual([]);
});
