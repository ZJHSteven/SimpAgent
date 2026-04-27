# SimpAgent 协作规则

## SQLite 表结构维护规则

- `docs/SQLite表结构.md` 是当前项目 SQLite 持久化结构的人类可读真源。
- 任何会改变 SQLite 表、字段、索引、外键、枚举值、事件类型、节点类型或边类型的代码改动，都必须先更新 `docs/SQLite表结构.md`。
- 代码实现必须和 `docs/SQLite表结构.md` 保持一致；如果实现过程中发现文档设计不合理，先改文档，再改代码。
- 当前主线不保留旧 MVP JSON trace 的兼容债。需要替换时直接替换，避免让新架构背历史临时方案。
- 当前持久化哲学：
  - `conversations` 是顶层容器。
  - `nodes + edges` 是定义层真源。
  - `events` 是运行事实。
  - graph 只是由 `nodes + edges` 查询得到的投影，不单独建立 `graphs` 真源表。
  - 不建立 `runs` / `turns` 表；模型请求、工具调用、提示词编译、handoff 等运行步骤都记录为事件。

## 代码与文档风格

- 面向初学者维护：新增重要文件要有文件头注释，关键函数要解释输入、输出、核心逻辑和边界处理。
- `agent-core` 负责跨运行时核心抽象、agent loop、事件协议、工具闭环和类型契约。
- `runtime-node` 负责 Node 环境能力，例如文件系统、shell、审批和 SQLite 持久化。
- `PROGRESS.md` 保存短状态快照；`PLANS.md` 只保存仍需要执行或验证的计划。
