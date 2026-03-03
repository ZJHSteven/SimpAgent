/**
 * 文件作用：
 * - 统一定义临床教学运行舱前端使用的数据类型。
 * - 把“页面展示结构”和“运行状态结构”分离，避免组件直接依赖后端返回格式。
 *
 * 设计取舍说明：
 * - 这里全部使用前端展示友好的字段命名，便于初学者阅读。
 * - 若未来接入真实接口，只需在数据适配层做一次转换，不需要改动 UI 组件。
 */

/** 角色枚举：用于对话区和节点区的统一渲染。 */
export type SpeakerRole = "学生" | "虚拟患者" | "临床专家" | "基础研究专家" | "临床导师";

/** 对话消息：左侧会话面板每一条消息的结构。 */
export interface ConversationMessage {
  /** 唯一标识，供 React 列表渲染使用。 */
  id: string;
  /** 角色名称。 */
  role: SpeakerRole;
  /** 文本内容。 */
  content: string;
  /** 展示时间（字符串形式，方便直接渲染）。 */
  timeText: string;
}

/** 节点视觉类别：用于区分不同卡片颜色和高亮风格。 */
export type FlowNodeKind = "患者" | "学生" | "临床" | "研究" | "总结" | "导师";

/** 画布节点结构：中间无限画布中的每个节点。 */
export interface FlowNode {
  /** 节点唯一编号。 */
  id: string;
  /** 节点标题。 */
  title: string;
  /** 节点副标题（当前状态说明）。 */
  subtitle: string;
  /** 节点类别。 */
  kind: FlowNodeKind;
  /** 节点在画布平面中的左上角 X 坐标。 */
  x: number;
  /** 节点在画布平面中的左上角 Y 坐标。 */
  y: number;
}

/** 连线结构：画布中连接两个节点的路径定义。 */
export interface FlowEdge {
  /** 连线唯一编号。 */
  id: string;
  /** 起点节点编号。 */
  from: string;
  /** 终点节点编号。 */
  to: string;
  /** 连线旁展示的中文标签。 */
  label: string;
}

/** 日志级别：用于底部日志颜色分类。 */
export type RuntimeLogLevel = "信息" | "提示" | "警示";

/** 一条日志记录：底部日志表格展示。 */
export interface RuntimeLogRow {
  /** 时间文本。 */
  timeText: string;
  /** 级别。 */
  level: RuntimeLogLevel;
  /** 日志来源（节点或模块名）。 */
  source: string;
  /** 日志描述。 */
  content: string;
}

/** 流程步骤：决定当前高亮节点、连线、右侧时间线和新增日志。 */
export interface FlowStep {
  /** 步骤唯一编号。 */
  id: string;
  /** 步骤标题。 */
  title: string;
  /** 步骤详细说明。 */
  detail: string;
  /** 当前步骤高亮的节点编号列表。 */
  activeNodeIds: string[];
  /** 当前步骤高亮的连线编号列表。 */
  activeEdgeIds: string[];
  /** 切换到该步骤时新增的日志级别。 */
  logLevel: RuntimeLogLevel;
  /** 切换到该步骤时新增的日志来源。 */
  logSource: string;
  /** 切换到该步骤时新增的日志内容。 */
  logContent: string;
}

/** 顶部元数据：用于页面标题、版本、会话信息显示。 */
export interface CockpitMeta {
  /** 页面主标题。 */
  title: string;
  /** 页面副标题。 */
  subtitle: string;
  /** 版本号（中文展示，不使用英文前缀）。 */
  versionText: string;
  /** 会话编号。 */
  sessionCode: string;
  /** 当前临床场景名。 */
  scenarioName: string;
}

/** 右侧文献卡片结构：用于展示临床证据与延伸阅读。 */
export interface ReferenceItem {
  /** 文献标题。 */
  title: string;
  /** 文献来源。 */
  source: string;
  /** 文献摘要。 */
  summary: string;
}
