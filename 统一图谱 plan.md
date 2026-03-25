# 统一图谱接入 PromptUnit 主链路 + MCP/Skills CodeMode 适配实现计划

## 摘要
本轮实现以“图谱服务 PromptUnit 编译链路”为核心，不做一个旁路图谱系统。最终目标是：图谱里统一存放可复用 PromptUnit、工具/技能/MCP 节点及其描述与执行元数据；`AgentSpec` 继续独立存在，只保存 PromptUnit ID、顺序、插入规则；运行时从图谱取节点，生成 `PromptUnit -> messages[]`，并让 MCP/skills 通过统一的 CodeMode shell bridge 接入。

第一版 MCP 主路线固定为：`CodeMode + shell bridge`，覆盖 `stdio + streamable-http + SSE`。不把 MCP 工具直接长期暴露成 provider function tool；JSON Schema 保留在节点里用于校验、审计和未来直通，不作为本轮默认暴露路径。内部标准参数形态用 `args-json`，同时兼容 flags 输入。

## 关键实现
### 1. 图谱与 PromptUnit 的契约收口
- 在核心契约中新增统一图谱类型，最小落地：
  - `CatalogNode`
  - `CatalogRelation`
  - `CatalogNodeFacet`
- 节点仍采用统一外形，Prompt/Memory/Tool/Integration 差异通过 facet 表达。
- `PromptUnitSpec` 继续保留为编译器直接消费的类型，不改掉现有 `Agent.promptBindings` 语义。
- 新增一种明确来源：图谱中的 PromptUnit 节点会被解析成 `PromptUnitSpec`，并在 `PromptUnitSource` 中标记为来自 catalog。
- `AgentSpec` 不进图谱；Agent 继续只保存：
  - PromptUnit ID
  - 启停
  - 顺序
  - 插入位置/覆盖规则
- 约束固定：
  - PromptUnit 的稳定 ID 就是图谱中该 prompt 节点的 ID
  - 编译器按 ID 从图谱取定义，不再依赖旧表作为唯一真源
  - 旧 `prompt_blocks/prompt_units` 先保留兼容读取与迁移，不作为新功能主来源

### 2. SQLite 与存储层
- 在 `packages/core/src/types/contracts.ts` 定义 catalog 契约。
- 在 `packages/runtime-node` 存储层新增三张主表：
  - `catalog_nodes`
  - `catalog_relations`
  - `catalog_node_facets`
- 树结构主路径用 `parent_node_id + sort_order`；横向引用才写 `catalog_relations`。
- Prompt 节点内容进入：
  - `catalog_nodes.summary_text`
  - `catalog_nodes.content_text`
  - `prompt` facet 存 role / insertion / priority / trigger / variablesSchema
- Tool 节点内容进入：
  - 节点正文存描述、示例和使用说明
  - `tool` facet 存 `inputSchema/outputSchema/executionMode/permission/timeout`
- MCP server 配置进入 `integration` facet，必须支持三类 transport：
  - `stdio`
  - `streamable-http`
  - `sse`
- 第一批 DB API 只做当前快照 CRUD，不先做 catalog 版本历史；历史审计继续复用现有运行态与审计表。

### 3. PromptCompiler 接图谱
- 编译器输入不改现有主接口，仍是 `Agent + PromptUnitSpec[] + PromptCompileRequest`。
- 运行时在 compile 前增加“图谱解析层”：
  - 根据 Agent 的 promptBindings 里的 ID，从 catalog 取对应 prompt 节点
  - 转成 `PromptUnitSpec[]`
  - 再喂给现有 `PromptCompiler`
- 第一版只要求“显式 PromptUnit 节点”能稳定进入 compile 主链路。
- tools/memory/skills/MCP 的描述注入采用“图谱节点投影成 PromptUnit”的方式进入现有：
  - `tool_catalog`
  - `tool_detail`
  - `tool_hint`
  - `memory/worldbook`
- 规则固定：
  - summary 优先进入目录/提示类 PromptUnit
  - content 在命中展开或详细暴露时进入 detail 类 PromptUnit
  - Tool/MCP/Skill 的结构化 schema 不直接长篇塞进 prompt，只保留精简描述与桥接调用说明
- 旧 `listPromptUnits/getPromptUnit` 路径先继续可用；实现上增加 catalog 读取优先级或兼容映射层，避免一次性打碎旧 API。

### 4. MCP CodeMode 适配层
- 新增内部 MCP bridge，不依赖第三方 CLI 作为运行前提。
- 实现分两层：
  - MCP 连接层：按 server 配置连接 `stdio / streamable-http / sse`
  - MCP 映射层：执行 `tools/list`，把 server/tool 映射成 catalog 节点与 facet
- 每个 MCP tool 节点至少包含两部分：
  - 描述部分：summary/content，供 PromptUnit 投影和模型理解
  - 执行部分：`tool` facet，保留 `inputSchema/outputSchema` 与 bridge 元数据
- 第一版统一桥接命令固定为内部标准：
  - `simpagent mcp call --server <serverId> --tool <toolName> --args-json '<json>'`
- 同时兼容 flags 形式输入，但实现策略固定：
  - 内部标准始终归一化为 `args-json`
  - flags 只作为命令入口兼容，进入 runtime 后先归一化再校验
- MCP 的默认模型暴露策略固定为：
  - 不把每个 MCP tool 作为 provider function tool 直接暴露
  - 只通过 PromptUnit 描述告诉模型可用 MCP 工具与调用方式
  - 实际执行由模型调用现有 `shell_command`，命令内容为内部 MCP bridge 命令
- shell bridge 执行时必须做：
  - 命令解析
  - server/tool 定位
  - schema 校验
  - transport 调用
  - 输出标准化
  - trace / side_effect / tool_call 审计
- 若后续要支持 MCP function-call 直通，本轮仅保留数据字段与接口挂点，不作为默认流程。

### 5. Skills 适配层
- Skills 第一版按本地 bundle 处理，不做远程 skill registry。
- skill 节点至少映射：
  - description 元数据 -> summary/content
  - 正文/参考说明 -> `prompt` facet
  - script/可执行入口 -> `tool` facet
  - assets/reference 位置 -> metadata 或 integration facet
- Skills 默认也走 CodeMode：
  - 描述通过 PromptUnit 暴露
  - 执行通过 `shell_command` 调内部 bridge 或本地脚本入口
- 与 MCP 保持同一原则：
  - 模型看到的是说明与调用规范
  - runtime 保留 schema 和执行定义
  - 实际执行统一走 shell bridge 语义

## 测试计划
- 图谱存储：
  - `catalog_nodes / relations / facets` 的 CRUD、项目隔离、父子树查询、横向关系查询
  - Prompt/Tool/Integration facet 解析正确
- Prompt 编译：
  - Agent 按 PromptUnit ID 从图谱成功取回 prompt 节点并编译
  - 插入位置、顺序、覆盖、anchor 逻辑不回归
  - tool catalog/tool detail/tool hint 由图谱节点成功投影
- MCP 适配：
  - `stdio / streamable-http / sse` 三类 transport 都能 `tools/list`
  - 映射出的 MCP tool 节点包含正确 description 与 schema
  - `args-json` 与 flags 两种输入都能归一化并通过校验
  - shell bridge 命令能正确调用 `tools/call`
  - transport 错误、schema 错误、server 不可达、tool 不存在都能返回结构化错误
- Skills 适配：
  - 本地 bundle 映射为节点成功
  - description/reference/script 进入正确节点字段
  - script 型 skill 可通过 shell bridge 执行并留下审计
- 兼容性：
  - 旧 Agent 定义不需要改结构即可继续运行
  - 旧 PromptUnit API 仍能读取到图谱中的 PromptUnit 或兼容映射结果
  - builtin tools 行为不回归
- 运行时可观测性：
  - MCP/skill bridge 执行时必须写入 `trace_events`
  - `tool_calls`
  - `side_effects`
  - 必要时记录桥接后的标准命令和归一化参数

## 收口补齐（2026-03-25）
- 上一轮已经补了 `test:smoke` 与 `test:catalog-bridge` 两个专项测试脚本，但根级 `npm run test:workspaces` 仍然空转，因为 `@simpagent/runtime-node` 还没有统一 `test` 入口。
- 本轮补齐要求：
  - `packages/runtime-node/package.json` 增加 `test` 聚合脚本，串联 `test:smoke + test:catalog-bridge`
  - 根级 `npm run test:workspaces` 必须真实执行统一图谱与工具桥接回归，而不是只返回空成功
- 这样后续继续推进 Shell/Exec 权限模型时，package 层已经具备最小统一回归入口。

## 收口补齐完成（2026-03-25）
- 已补齐 package 层剩余核心缺口：
  - `shell_command` 权限内核：`deny / ask / allow`
  - `approval_requests` 审批记录与恢复链路
  - `catalog` 的节点 / facet / relation HTTP CRUD
  - `permissions-catalog` 专项测试
- 当前统一图谱 + MCP/skills 主链已经不再只停留在“能跑”，而是具备：
  - 定义层统一
  - MCP/skill shell bridge
  - 权限/审批主链
  - 最小编辑 API
  - 根级统一测试入口
- 后续剩余工作将转向“更细粒度权限维度（network / fs 等）”与“更完整的 API/WS 测试矩阵”，不再属于这一轮统一图谱主链的未完成项。

## 假设与默认
- `AgentSpec` 继续独立于图谱，不进入 catalog。
- PromptUnit 的稳定 ID 由图谱节点 ID 承担，Agent 绑定的就是这个 ID。
- 第一阶段先把“图谱中的 PromptUnit 节点”接进编译主链；更泛化的“任意节点皆可投影”为第二层能力，但工具目录、memory、skills、MCP 描述投影本轮要提供最小可用链路。
- MCP 第一版只认统一主路线：CodeMode + shell bridge；不做长期双轨混跑。
- 内部参数标准始终是 `args-json`；flags 只是兼容入口，不是内部主协议。
- 不把第三方 `mcp-cli` 作为硬依赖；如需参考，只用于借鉴交互形态，不绑定运行时实现。
