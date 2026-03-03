/**
 * 文件作用：
 * - 中间“无限画布”区域，负责节点拓扑渲染、连线动画、拖拽平移。
 * - 这是本页面最核心的视觉区，突出“非线性多角色协同”。
 */

import { useMemo, useRef, useState } from "react";
import type { PointerEventHandler } from "react";
import type { FlowEdge, FlowNode, FlowNodeKind, FlowStep } from "../types";

interface CanvasPanelProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  currentStep: FlowStep;
  isRunning: boolean;
  onToggleRunning: () => void;
}

/** 节点卡片尺寸：用于计算连线锚点。 */
const NODE_WIDTH = 230;
const NODE_HEIGHT = 108;

/** 画布平面尺寸：做“大于视口”的无限感。 */
const PLANE_WIDTH = 2800;
const PLANE_HEIGHT = 1900;

/** 统一坐标结构。 */
interface Point {
  x: number;
  y: number;
}

/** 二次贝塞尔路径计算结果。 */
interface BezierLayout {
  pathD: string;
  labelX: number;
  labelY: number;
}

/** 拖拽状态结构。 */
interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
}

/**
 * 根据节点类别返回样式类名。
 * - 把类别与视觉样式映射集中管理，避免 JSX 里散乱判断。
 */
function kindClassName(kind: FlowNodeKind): string {
  if (kind === "患者") return "kind-patient";
  if (kind === "学生") return "kind-student";
  if (kind === "临床") return "kind-clinical";
  if (kind === "研究") return "kind-research";
  if (kind === "汇总") return "kind-summary";
  return "kind-mentor";
}

/**
 * 计算二次贝塞尔路径：
 * - 输入起点与终点中心坐标；
 * - 输出 SVG path 字符串与标签中点。
 */
function buildBezierLayout(from: Point, to: Point): BezierLayout {
  const controlX = (from.x + to.x) / 2;
  const distanceY = Math.abs(to.y - from.y);
  const controlY = Math.min(from.y, to.y) - (distanceY * 0.32 + 80);

  const pathD = `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;

  const t = 0.5;
  const oneMinusT = 1 - t;
  const labelX = oneMinusT * oneMinusT * from.x + 2 * oneMinusT * t * controlX + t * t * to.x;
  const labelY = oneMinusT * oneMinusT * from.y + 2 * oneMinusT * t * controlY + t * t * to.y;

  return { pathD, labelX, labelY };
}

export function CanvasPanel(props: CanvasPanelProps) {
  const { nodes, edges, currentStep, isRunning, onToggleRunning } = props;

  /** 画布偏移量：通过拖拽不断累积，实现“平移浏览”。 */
  const [offset, setOffset] = useState({ x: -570, y: -180 });
  /** 当前是否正在拖拽：只用于光标样式。 */
  const [isDragging, setIsDragging] = useState(false);
  /** 拖拽细节放在 ref：避免频繁渲染。 */
  const dragRef = useRef<DragState | null>(null);

  /** 当前高亮节点集合。 */
  const activeNodeSet = useMemo(() => new Set(currentStep.activeNodeIds), [currentStep.activeNodeIds]);
  /** 当前高亮连线集合。 */
  const activeEdgeSet = useMemo(() => new Set(currentStep.activeEdgeIds), [currentStep.activeEdgeIds]);

  /** 节点索引：供连线快速查找起点终点。 */
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  /** 开始拖拽。 */
  const handlePointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".flow-node")) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    setIsDragging(true);
  };

  /** 拖拽中更新偏移。 */
  const handlePointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    if (!dragRef.current) return;
    if (dragRef.current.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragRef.current.lastX;
    const deltaY = event.clientY - dragRef.current.lastY;
    dragRef.current = { ...dragRef.current, lastX: event.clientX, lastY: event.clientY };

    setOffset((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
  };

  /** 结束拖拽。 */
  const handlePointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
    if (!dragRef.current) return;
    if (dragRef.current.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <section className="panel canvas-panel">
      <div className="panel-head">
        <h2>非线性协同画布</h2>
        <button type="button" className={isRunning ? "canvas-state running" : "canvas-state paused"} onClick={onToggleRunning}>
          {isRunning ? "自动推演中" : "手动观察中"}
        </button>
      </div>

      <div className="step-banner">
        <strong>{currentStep.title}</strong>
        <span>{currentStep.detail}</span>
      </div>

      <div
        className={`canvas-viewport ${isDragging ? "dragging" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="drag-hint">按住空白区域可拖动画布</div>

        <div className="canvas-plane" style={{ width: PLANE_WIDTH, height: PLANE_HEIGHT, transform: `translate(${offset.x}px, ${offset.y}px)` }}>
          <svg className="edge-layer" width={PLANE_WIDTH} height={PLANE_HEIGHT}>
            {edges.map((edge) => {
              const fromNode = nodeMap.get(edge.from);
              const toNode = nodeMap.get(edge.to);
              if (!fromNode || !toNode) return null;

              const fromPoint = { x: fromNode.x + NODE_WIDTH / 2, y: fromNode.y + NODE_HEIGHT / 2 };
              const toPoint = { x: toNode.x + NODE_WIDTH / 2, y: toNode.y + NODE_HEIGHT / 2 };
              const layout = buildBezierLayout(fromPoint, toPoint);
              const active = activeEdgeSet.has(edge.id);

              return (
                <g key={edge.id}>
                  <path className={`flow-edge ${active ? "active" : ""}`} d={layout.pathD} />
                  <text className={`edge-label ${active ? "active" : ""}`} x={layout.labelX} y={layout.labelY - 8} textAnchor="middle">
                    {edge.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {nodes.map((node) => {
            const active = activeNodeSet.has(node.id);
            return (
              <article
                key={node.id}
                className={`flow-node ${kindClassName(node.kind)} ${active ? "active" : ""}`}
                style={{ left: node.x, top: node.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
              >
                <h3>{node.title}</h3>
                <p>{node.subtitle}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
