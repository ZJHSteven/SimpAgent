/**
 * 文件作用：
 * - 提供临床教学运行舱的模拟数据（完全中文，可直接截图展示）。
 * - 数据稳定可复现，适合做动画演示和标书插图，不依赖后端接口即可运行。
 *
 * 维护建议：
 * - 若你后续接入真实后端，可保留本文件作为“离线演示模式”数据源。
 * - 所有展示文案都尽量保持医学语境和可读性，避免出现“测试占位词”。
 */

import type {
  CockpitMeta,
  ConversationMessage,
  FlowEdge,
  FlowNode,
  FlowStep,
  ReferenceItem,
  RuntimeLogRow
} from "./types";

/** 顶部元信息：控制页面主标题、场景标签和会话编号。 */
export const cockpitMeta: CockpitMeta = {
  title: "临床情境智能教学运行舱",
  subtitle: "多角色协同推演 · 非线性知识路径 · 实时可观测",
  versionText: "版本 2.4",
  sessionCode: "甲一九二",
  scenarioName: "主诉头痛的门诊首诊场景"
};

/** 左侧会话区初始消息：固定内容，便于展示稳定的截图效果。 */
export const initialConversation: ConversationMessage[] = [
  {
    id: "对话-1",
    role: "学生",
    content: "您好，我是今天接诊的实习医生。请问您头痛是什么时候开始的？",
    timeText: "10:42:15"
  },
  {
    id: "对话-2",
    role: "虚拟患者",
    content: "今天早晨开始的，像压着一样，不是突然炸裂那种痛。",
    timeText: "10:42:21"
  },
  {
    id: "对话-3",
    role: "学生",
    content: "有没有伴随发热、呕吐、肢体无力或者说话不清？",
    timeText: "10:42:44"
  },
  {
    id: "对话-4",
    role: "虚拟患者",
    content: "没有发热和呕吐，就是有点怕光，昨晚也没怎么睡好。",
    timeText: "10:42:58"
  },
  {
    id: "对话-5",
    role: "临床专家",
    content: "建议先排查危险信号，再按原发性头痛路径做分层处置。",
    timeText: "10:43:08"
  },
  {
    id: "对话-6",
    role: "基础研究专家",
    content: "可补充炎症与睡眠剥夺相关证据，帮助解释症状加重机制。",
    timeText: "10:43:16"
  }
];

/** 画布节点：通过坐标组织出“分支 + 汇合”的非线性拓扑。 */
export const flowNodes: FlowNode[] = [
  {
    id: "患者叙述",
    title: "虚拟患者叙述",
    subtitle: "描述症状与近期生活状态",
    kind: "患者",
    x: 860,
    y: 210
  },
  {
    id: "学生追问",
    title: "学生结构化追问",
    subtitle: "主动排查危险信号",
    kind: "学生",
    x: 520,
    y: 470
  },
  {
    id: "临床研判",
    title: "临床专家研判",
    subtitle: "给出处置优先级建议",
    kind: "临床",
    x: 860,
    y: 520
  },
  {
    id: "研究检索",
    title: "基础研究专家检索",
    subtitle: "补充机制与证据强度",
    kind: "研究",
    x: 1210,
    y: 470
  },
  {
    id: "联合结论",
    title: "联合结论生成",
    subtitle: "形成可执行教学反馈",
    kind: "总结",
    x: 1040,
    y: 810
  },
  {
    id: "患者反馈",
    title: "患者再次反馈",
    subtitle: "确认症状变化与接受度",
    kind: "患者",
    x: 670,
    y: 830
  },
  {
    id: "导师复盘",
    title: "临床导师复盘",
    subtitle: "指出关键诊疗思路",
    kind: "导师",
    x: 430,
    y: 1080
  }
];

/** 画布连线：包含分支与汇合，突出“非线性推演”特征。 */
export const flowEdges: FlowEdge[] = [
  { id: "连线-一", from: "患者叙述", to: "学生追问", label: "病史线索" },
  { id: "连线-二", from: "学生追问", to: "临床研判", label: "临床判断" },
  { id: "连线-三", from: "学生追问", to: "研究检索", label: "证据补充" },
  { id: "连线-四", from: "研究检索", to: "临床研判", label: "证据回流" },
  { id: "连线-五", from: "临床研判", to: "联合结论", label: "诊疗建议" },
  { id: "连线-六", from: "研究检索", to: "联合结论", label: "机制解释" },
  { id: "连线-七", from: "联合结论", to: "患者反馈", label: "沟通落地" },
  { id: "连线-八", from: "患者反馈", to: "导师复盘", label: "教学点评" },
  { id: "连线-九", from: "临床研判", to: "导师复盘", label: "能力归因" }
];

/** 步骤序列：驱动节点高亮、连线动画、右侧时间线和日志滚动。 */
export const flowSteps: FlowStep[] = [
  {
    id: "步骤-一",
    title: "患者首轮表达",
    detail: "系统先固定患者基线叙述，保证后续教学可重复对比。",
    activeNodeIds: ["患者叙述"],
    activeEdgeIds: [],
    logLevel: "信息",
    logSource: "虚拟患者",
    logContent: "患者症状模板已载入，首轮叙述完成。"
  },
  {
    id: "步骤-二",
    title: "学生结构化提问",
    detail: "学生按危险信号优先级提问，触发后续双专家协同。",
    activeNodeIds: ["患者叙述", "学生追问"],
    activeEdgeIds: ["连线-一"],
    logLevel: "信息",
    logSource: "学生",
    logContent: "完成危险信号初筛问题，进入专家协同阶段。"
  },
  {
    id: "步骤-三",
    title: "临床专家先行研判",
    detail: "临床专家给出首轮分层判断并提出必要检查建议。",
    activeNodeIds: ["学生追问", "临床研判"],
    activeEdgeIds: ["连线-二"],
    logLevel: "提示",
    logSource: "临床专家",
    logContent: "建议优先排除继发性头痛风险，再考虑原发性路径。"
  },
  {
    id: "步骤-四",
    title: "基础研究专家并行检索",
    detail: "研究专家并行补充证据，支撑临床判断解释力度。",
    activeNodeIds: ["学生追问", "研究检索"],
    activeEdgeIds: ["连线-三"],
    logLevel: "信息",
    logSource: "基础研究专家",
    logContent: "检索到睡眠剥夺与炎症标记升高的关联证据。"
  },
  {
    id: "步骤-五",
    title: "证据回流临床路径",
    detail: "研究证据回流临床节点，形成机制与处置的双重闭环。",
    activeNodeIds: ["研究检索", "临床研判"],
    activeEdgeIds: ["连线-四"],
    logLevel: "信息",
    logSource: "协同路由",
    logContent: "证据已注入临床推理，准备汇总结论。"
  },
  {
    id: "步骤-六",
    title: "多源信息汇合",
    detail: "临床建议与研究证据在联合结论节点完成融合。",
    activeNodeIds: ["临床研判", "研究检索", "联合结论"],
    activeEdgeIds: ["连线-五", "连线-六"],
    logLevel: "提示",
    logSource: "联合结论",
    logContent: "输出分层处置方案与沟通要点。"
  },
  {
    id: "步骤-七",
    title: "结论落地到患者沟通",
    detail: "把专业结论转为患者可理解表达，观察接受与反馈。",
    activeNodeIds: ["联合结论", "患者反馈"],
    activeEdgeIds: ["连线-七"],
    logLevel: "信息",
    logSource: "患者反馈",
    logContent: "患者可理解程度提升，焦虑评分下降。"
  },
  {
    id: "步骤-八",
    title: "导师教学复盘",
    detail: "导师回看全过程，标出关键节点与可改进提问策略。",
    activeNodeIds: ["临床研判", "患者反馈", "导师复盘"],
    activeEdgeIds: ["连线-八", "连线-九"],
    logLevel: "警示",
    logSource: "临床导师",
    logContent: "提醒：需要补问既往偏头痛家族史，避免信息缺口。"
  }
];

/** 底部日志初始数据：作为系统启动阶段的基线记录。 */
export const initialLogs: RuntimeLogRow[] = [
  {
    timeText: "10:42:45.120",
    level: "信息",
    source: "协同编排",
    content: "会话已建立，教学场景与角色模板载入完成。"
  },
  {
    timeText: "10:42:45.332",
    level: "信息",
    source: "虚拟患者",
    content: "患者个体化叙述人格已激活。"
  },
  {
    timeText: "10:42:45.650",
    level: "提示",
    source: "临床专家",
    content: "检测到学生提问进入危险信号筛查路径。"
  },
  {
    timeText: "10:42:46.018",
    level: "信息",
    source: "基础研究专家",
    content: "并行证据检索线程已就绪。"
  }
];

/** 右侧文献区条目：全部中文标题，避免截图时出现英文占位。 */
export const references: ReferenceItem[] = [
  {
    title: "成人急性头痛规范化评估路径（2025 版）",
    source: "国家临床指南协作组",
    summary: "强调危险信号优先筛查与分层处置，适合门诊教学首诊流程。"
  },
  {
    title: "睡眠剥夺与炎性反应在头痛症状中的作用",
    source: "临床与基础联合研究综述",
    summary: "提示睡眠不足可通过炎症通路加重症状，支持机制解释教学。"
  },
  {
    title: "医患沟通中的可理解表达策略",
    source: "医学教育实践研究",
    summary: "建议将专业结论转化为分层、可执行、可复述的沟通语句。"
  }
];
