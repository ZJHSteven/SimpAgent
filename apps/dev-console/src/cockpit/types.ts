/**
 * 文件作用：
 * - 定义临床教学运行舱前端使用的类型结构。
 * - 让“数据定义”和“界面渲染”解耦，后续切换真实接口更轻松。
 */

/** 对话角色枚举。 */
export type SpeakerRole = "学生" | "虚拟患者" | "临床专家" | "基础研究专家" | "临床导师";

/** 左侧会话消息结构。 */
export interface ConversationMessage {
  /** 唯一编号（用于列表 key）。 */
  id: string;
  /** 发言角色。 */
  role: SpeakerRole;
  /** 发言内容。 */
  content: string;
  /** 展示时间。 */
  timeText: string;
}

/** 画布节点分类。 */
export type FlowNodeKind = "患者" | "学生" | "临床" | "研究" | "汇总" | "导师";

/** 中间画布节点结构。 */
export interface FlowNode {
  id: string;
  title: string;
  subtitle: string;
  kind: FlowNodeKind;
  x: number;
  y: number;
}

/** 节点连线结构。 */
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

/** 底部日志级别。 */
export type RuntimeLogLevel = "信息" | "提示" | "警示";

/** 底部日志结构。 */
export interface RuntimeLogRow {
  timeText: string;
  level: RuntimeLogLevel;
  source: string;
  content: string;
}

/** 流程步骤结构：驱动画布高亮和日志增量。 */
export interface FlowStep {
  id: string;
  title: string;
  detail: string;
  activeNodeIds: string[];
  activeEdgeIds: string[];
  logLevel: RuntimeLogLevel;
  logSource: string;
  logContent: string;
}

/** 页面头部基础信息。 */
export interface CockpitMeta {
  title: string;
  subtitle: string;
  versionText: string;
  sessionCode: string;
  scenarioName: string;
}

/** 右侧证据条目。 */
export interface EvidenceCard {
  title: string;
  source: string;
  summary: string;
}
