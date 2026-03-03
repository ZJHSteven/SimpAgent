/**
 * 文件作用：
 * - 底部日志区，展示流程每一步触发的系统记录。
 * - 颜色按级别区分，便于现场讲解时快速定位关键信息。
 */

import type { RuntimeLogRow } from "../types";

interface LogPanelProps {
  logs: RuntimeLogRow[];
}

function levelClass(level: RuntimeLogRow["level"]): string {
  if (level === "提示") return "level-hint";
  if (level === "警示") return "level-warn";
  return "level-info";
}

export function LogPanel(props: LogPanelProps) {
  const { logs } = props;

  return (
    <section className="panel log-panel">
      <div className="panel-head">
        <h2>系统日志区</h2>
        <span className="log-count">共 {logs.length} 条</span>
      </div>

      <div className="log-table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>级别</th>
              <th>来源</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((row) => (
              <tr key={`${row.timeText}-${row.source}-${row.content}`}>
                <td>{row.timeText}</td>
                <td>
                  <span className={`level-pill ${levelClass(row.level)}`}>{row.level}</span>
                </td>
                <td>{row.source}</td>
                <td>{row.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
