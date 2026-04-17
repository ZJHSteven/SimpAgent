/*
 * 文件作用：
 * 这里集中保存静态聊天界面需要展示的数据。
 *
 * 为什么要这样做：
 * 旧版 HTML 把历史记录、消息正文、表格、思考步骤都直接写在 DOM 里。
 * React 版把这些内容改成数组和对象，组件只负责“怎么显示”，数据文件负责“显示什么”。
 */

export const DEFAULT_HELP_TEXT =
  'Enter 发送，Shift + Enter 换行。SimpChat 也可能会犯错，请核查重要信息。'

export const historyGroups = [
  {
    id: 'today',
    title: '今天',
    items: ['规则与数值模拟'],
  },
  {
    id: 'recent',
    title: '最近',
    items: [
      '骰子概率分析',
      '个人开发者接入 ChatGPT',
      'API 架构与 LangGraph 分析',
      'Quest3 局域网代理配置',
      '文件上传与检索方式',
    ],
  },
]

export const thoughtSteps = [
  {
    id: 'search-fancyss',
    iconId: '6b0d8c',
    title: 'Searching GitHub for FancySS update temp files',
    sources: [
      { id: 'github', label: 'github.com', href: 'https://github.com' },
      { id: 'gist', label: 'gist.github.com', href: 'https://gist.github.com' },
    ],
  },
  {
    id: 'check-cleanup',
    iconId: '6b0d8c',
    title: 'Checking repo for cleanup paths and definitions',
    text: 'I’m weighing the possibility of inspecting the repo for cleanup or uninstall instructions, then narrowing the advice to safe file inspection first.',
  },
  {
    id: 'inspect-repo',
    iconId: '6b0d8c',
    title: 'Inspecting GitHub repo for uninstall/cleanup information',
    sources: [
      {
        id: 'fancyss',
        label: 'github.com',
        href: 'https://github.com/iKenzo/KoolShare-fancyss',
      },
    ],
  },
  {
    id: 'done',
    iconId: 'a4763e',
    title: 'Thought for 2m 17s',
    text: '完成',
  },
]

export const initialMessages = [
  {
    id: 'initial-user',
    role: 'user',
    text: '给我算一下这个骰子规则的成功概率：目标值是 15 或 16，有 1 个 12 面骰，再加 1 到 3 个 6 面骰；12 面骰的 12 是大成功，11 算 0，优势时 12 面骰投两个取高。',
  },
  {
    id: 'initial-assistant',
    role: 'assistant',
    paragraphs: [
      '我先按这版规则做一个展示表。这里的重点不是精确复现模型能力，而是复刻 ChatGPT 风格的消息阅读体验。',
      '原页面里缺的是“本地可运行的样式和行为”。只复制 DOM 会把线上样式、脚本、图标和用户数据一起带进来，但离开原站后这些依赖并不可靠。',
    ],
    table: {
      headers: ['情况', '目标 15', '目标 16'],
      rows: [
        ['无优势 + 1 个 D6', '约 8.3%', '约 8.3%'],
        ['无优势 + 2 个 D6', '约 26.9%', '约 21.3%'],
        ['优势 + 3 个 D6', '明显更高', '仍比目标 15 难'],
      ],
    },
    code: `// 样式抽取思路：保留结构，重写本地样式。
layout = sidebar + header + messageThread + composer
userMessage = rightAlignedGrayBubble
assistantMessage = readableMarkdownColumn`,
    thought: {
      label: '已思考 2m 17s',
    },
  },
]

export function createAssistantReplyMessage(userText, override = {}) {
  // preview 只用于本地模拟回复，避免超长用户输入把第一段提示撑得太长。
  const preview =
    userText.length > 42 ? `${userText.slice(0, 42)}...` : userText

  // override 让“新聊天欢迎语”可以复用同一种助手消息结构。
  return {
    id: override.id ?? `assistant-${Date.now()}`,
    role: 'assistant',
    paragraphs:
      override.paragraphs ?? [
        `我收到的是：“${preview}”`,
        '这是一个本地静态演示，所以不会真正调用模型；它只模拟 ChatGPT 风格的消息追加、滚动和输入器反馈。',
        '如果以后要接入真实接口，可以把本地模拟回复替换成 API 请求，并把错误处理放到统一的请求函数里。',
      ],
  }
}
