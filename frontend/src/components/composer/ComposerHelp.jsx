/*
 * 文件作用：
 * ComposerHelp 渲染输入器下方的提示或错误文案。
 *
 * data-tone 继续沿用旧页面 CSS 设计，普通提示和错误提示只改属性不写内联样式。
 */

export function ComposerHelp({ help }) {
  return (
    <div className="composer-help" id="composer-help" data-tone={help.tone}>
      {help.text}
    </div>
  )
}
