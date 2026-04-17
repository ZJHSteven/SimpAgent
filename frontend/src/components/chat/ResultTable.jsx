/*
 * 文件作用：
 * ResultTable 渲染助手消息里的示例结果表。
 *
 * 好处：
 * 表格结构从消息组件中抽出，后续如果 API 返回表格数据，只需要复用这个组件。
 */

export function ResultTable({ table }) {
  if (!table) {
    return null
  }

  return (
    <table className="result-table">
      <thead>
        <tr>
          {table.headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.join('|')}>
            {row.map((cell) => (
              <td key={cell}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
