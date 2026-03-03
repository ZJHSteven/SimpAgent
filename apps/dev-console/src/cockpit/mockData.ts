/**
 * 文件作用：
 * - 提供运行舱演示所需的稳定 mock 数据。
 * - 保证“全中文 + 可截图 + 可重复”。
 */

import type {
  CockpitMeta,
  ConversationMessage,
  EvidenceCard,
  FlowEdge,
  FlowNode,
  FlowStep,
  RuntimeLogRow
} from "./types";

/** 顶部元数据。 */
export const cockpitMeta: CockpitMeta = {
  title: "临床情境智能教学运行舱",
  subtitle: "多角色协同推演 · 非线性知识路径 · 实时可观测",
  versionText: "版本 2.4",
  sessionCode: "甲一九二",
  scenarioName: "主诉头痛的门诊首诊场景"
};

/** 左侧会话初始内容。 */
export const initialConversation: ConversationMessage[] = [
  {
    id: "消息-一",
    role: "学生",
    content: "您好，我是今天接诊的实习医生。请问头痛从什么时候开始？",
    timeText: "10:42:15"
  },
  {
    id: "消息-二",
    role: "虚拟患者",
    content: "今天早晨开始的，像被压住一样，不是突然最剧烈的那种痛。",
    timeText: "10:42:22"
  },
  {
    id: "消息-三",
    role: "学生",
    content: "有没有伴随发热、呕吐、肢体无力，或者说话不清楚？",
    timeText: "10:42:41"
  },
  {
    id: "消息-四",
    role: "虚拟患者",
    content: "没有发热和呕吐，就是怕光，昨晚睡得很差。",
    timeText: "10:42:57"
  },
  {
    id: "消息-五",
    role: "临床专家",
    content: "建议先排除危险信号，再按原发性头痛路径做分层处置。",
    timeText: "10:43:07"
  },
  {
    id: "消息-六",
    role: "基础研究专家",
    content: "可并行补充睡眠剥夺与炎症通路证据，帮助解释症状机制。",
    timeText: "10:43:15"
  }
];

/** 画布节点。 */
export const flowNodes: FlowNode[] = [
  { id: "患者叙述", title: "虚拟患者叙述", subtitle: "描述症状与生活背景", kind: "患者", x: 880, y: 220 },
  { id: "学生追问", title: "学生结构化追问", subtitle: "先问危险信号", kind: "学生", x: 540, y: 500 },
  { id: "临床研判", title: "临床专家研判", subtitle: "给出处置优先级", kind: "临床", x: 880, y: 550 },
  { id: "研究检索", title: "基础研究专家检索", subtitle: "补充证据与机制", kind: "研究", x: 1240, y: 500 },
  { id: "联合结论", title: "联合结论生成", subtitle: "整合建议并形成反馈", kind: "汇总", x: 1060, y: 860 },
  { id: "患者反馈", title: "患者反馈确认", subtitle: "观察理解与接受度", kind: "患者", x: 680, y: 860 },
  { id: "导师复盘", title: "临床导师复盘", subtitle: "标注可改进提问点", kind: "导师", x: 420, y: 1120 }
];

/** 画布连线。 */
export const flowEdges: FlowEdge[] = [
  { id: "连线-一", from: "患者叙述", to: "学生追问", label: "病史线索" },
  { id: "连线-二", from: "学生追问", to: "临床研判", label: "临床判断" },
  { id: "连线-三", from: "学生追问", to: "研究检索", label: "证据请求" },
  { id: "连线-四", from: "研究检索", to: "临床研判", label: "证据回流" },
  { id: "连线-五", from: "临床研判", to: "联合结论", label: "处置建议" },
  { id: "连线-六", from: "研究检索", to: "联合结论", label: "机制说明" },
  { id: "连线-七", from: "联合结论", to: "患者反馈", label: "沟通落地" },
  { id: "连线-八", from: "患者反馈", to: "导师复盘", label: "教学点评" },
  { id: "连线-九", from: "临床研判", to: "导师复盘", label: "能力归因" }
];

/** 流程步骤。 */
export const flowSteps: FlowStep[] = [
  {
    id: "步骤-一",
    title: "患者首轮表达",
    detail: "系统固定患者基线叙述，保证课堂推演可重复。",
    activeNodeIds: ["患者叙述"],
    activeEdgeIds: [],
    logLevel: "信息",
    logSource: "虚拟患者",
    logContent: "患者叙述模板已加载。"
  },
  {
    id: "步骤-二",
    title: "学生发起结构化提问",
    detail: "学生先问危险信号，再决定后续分支路径。",
    activeNodeIds: ["患者叙述", "学生追问"],
    activeEdgeIds: ["连线-一"],
    logLevel: "信息",
    logSource: "学生",
    logContent: "完成危险信号筛查问题。"
  },
  {
    id: "步骤-三",
    title: "临床专家先行研判",
    detail: "临床专家给出初步分层，提示必要排查。",
    activeNodeIds: ["学生追问", "临床研判"],
    activeEdgeIds: ["连线-二"],
    logLevel: "提示",
    logSource: "临床专家",
    logContent: "建议先排除继发性头痛风险。"
  },
  {
    id: "步骤-四",
    title: "基础研究并行检索",
    detail: "研究专家并行补充证据，增强解释力度。",
    activeNodeIds: ["学生追问", "研究检索"],
    activeEdgeIds: ["连线-三"],
    logLevel: "信息",
    logSource: "基础研究专家",
    logContent: "检索到睡眠剥夺与炎症相关证据。"
  },
  {
    id: "步骤-五",
    title: "证据回流临床推理",
    detail: "研究证据回流临床节点，形成双重闭环。",
    activeNodeIds: ["研究检索", "临床研判"],
    activeEdgeIds: ["连线-四"],
    logLevel: "信息",
    logSource: "协同编排",
    logContent: "证据已注入临床推理链。"
  },
  {
    id: "步骤-六",
    title: "多源信息汇合",
    detail: "临床建议与研究证据在联合结论节点融合。",
    activeNodeIds: ["临床研判", "研究检索", "联合结论"],
    activeEdgeIds: ["连线-五", "连线-六"],
    logLevel: "提示",
    logSource: "联合结论",
    logContent: "输出分层处置与沟通要点。"
  },
  {
    id: "步骤-七",
    title: "患者沟通与反馈",
    detail: "将结论转化为患者可理解表达，并观察反馈。",
    activeNodeIds: ["联合结论", "患者反馈"],
    activeEdgeIds: ["连线-七"],
    logLevel: "信息",
    logSource: "患者反馈",
    logContent: "患者理解度提升，焦虑下降。"
  },
  {
    id: "步骤-八",
    title: "导师复盘点评",
    detail: "导师对关键提问与诊疗思路进行复盘。",
    activeNodeIds: ["临床研判", "患者反馈", "导师复盘"],
    activeEdgeIds: ["连线-八", "连线-九"],
    logLevel: "警示",
    logSource: "临床导师",
    logContent: "提醒补问家族史，避免信息缺口。"
  }
];

/** 初始日志。 */
export const initialLogs: RuntimeLogRow[] = [
  { timeText: "10:42:45.101", level: "信息", source: "协同编排", content: "会话建立成功，场景配置已加载。" },
  { timeText: "10:42:45.248", level: "信息", source: "虚拟患者", content: "患者人格参数激活完成。" },
  { timeText: "10:42:45.608", level: "提示", source: "临床专家", content: "已识别到危险信号筛查路径。" },
  { timeText: "10:42:45.931", level: "信息", source: "基础研究专家", content: "并行证据检索线程已就绪。" }
];

/** 右侧证据与文献。 */
export const evidenceCards: EvidenceCard[] = [
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
