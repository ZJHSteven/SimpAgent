/*
 * 文件作用：
 * 这个 Playwright 测试文件用于验证 tem.html 这个本地静态聊天页面是否真的可用。
 *
 * 测试范围：
 * 1. 桌面端基础渲染：标题、侧栏、输入器和图片都要存在。
 * 2. 输入边界：空输入不发送，Shift + Enter 只换行，Enter 正常发送。
 * 3. 移动端布局：侧栏可以打开，新聊天可以重置内容，页面不能横向溢出。
 * 4. 异常监听：浏览器控制台不能出现 error，页面不能抛 pageerror。
 */

// 引入 Playwright Test 的 test 和 expect，用于组织用例和断言结果。
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

// 检查页面中的图片已经加载完成，确保视觉节点不是空白。
async function expectImagesLoaded(page) {
  // 在浏览器中检查每个 img 的加载状态和自然宽高。
  const images = await page.evaluate(() =>
    Array.from(document.images).map((image) => ({
      alt: image.alt,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    })),
  );

  // 页面至少应该包含品牌图和助手头像。
  expect(images.length).toBeGreaterThanOrEqual(2);

  // 每一张图片都必须完成加载，并且有实际像素尺寸。
  for (const image of images) {
    expect(image.complete, `${image.alt} 应该完成加载`).toBe(true);
    expect(image.naturalWidth, `${image.alt} 应该有宽度`).toBeGreaterThan(0);
    expect(image.naturalHeight, `${image.alt} 应该有高度`).toBeGreaterThan(0);
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

  // 输入框应该有预期占位文本。
  await expect(page.getByPlaceholder("有问题，尽管问")).toBeVisible();

  // 页面图片应该正常加载。
  await expectImagesLoaded(page);

  // 桌面端不应横向溢出。
  await expectNoHorizontalOverflow(page);

  // 空输入按 Enter 应提示错误，且不会新增用户气泡。
  await page.getByPlaceholder("有问题，尽管问").press("Enter");
  await expect(page.locator("#composer-help")).toContainText("请先输入内容");

  // 记录发送前的用户消息数量。
  const userBubbleCountBefore = await page.locator(".user-bubble").count();

  // Shift + Enter 应该换行，不应发送。
  await page.getByPlaceholder("有问题，尽管问").fill("第一行");
  await page.getByPlaceholder("有问题，尽管问").press("Shift+Enter");
  await page.getByPlaceholder("有问题，尽管问").type("第二行");
  await expect(page.getByPlaceholder("有问题，尽管问")).toHaveValue("第一行\n第二行");
  await expect(page.locator(".user-bubble")).toHaveCount(userBubbleCountBefore);

  // Enter 应该发送消息，并追加一条本地模拟助手回复。
  await page.getByPlaceholder("有问题，尽管问").press("Enter");
  await expect(page.locator(".user-bubble")).toHaveCount(userBubbleCountBefore + 1);
  await expect(page.locator(".assistant-content").last()).toContainText("本地静态演示");

  // 发送后输入框应该被清空，发送按钮应该重新禁用。
  await expect(page.getByPlaceholder("有问题，尽管问")).toHaveValue("");
  await expect(page.getByLabel("发送消息")).toBeDisabled();

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
