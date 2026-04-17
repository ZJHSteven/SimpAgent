/*
 * 文件作用：
 * Icon 组件统一渲染 SVG sprite 图标。
 *
 * 为什么要统一：
 * 旧 HTML 到处手写 <svg><use href="#id" /></svg>，迁移后如果每处都手写，
 * 后续换 sprite 路径、补 aria 属性、查缺失图标都会很分散。
 */

export function Icon({
  id,
  size = 20,
  className = 'icon',
  fill = 'currentColor',
  ariaHidden = true,
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      aria-hidden={ariaHidden}
    >
      <use href={`/icons.svg#${id}`} fill={fill}></use>
    </svg>
  )
}
