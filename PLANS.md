# ExecPlan（复杂任务先计划）

## 任务名称（2026-04-01）
- dev-console 测试项目深化：项目级后端隔离 + 专属 preset + 可视化调试台增强

## 本轮背景
- 上一阶段已经完成：
  - 文档收口
  - `apps/dev-console` 最小前后端壳恢复
  - `runtime-node` 主链构建与测试
  - DeepSeek 真实 `chat_completions` + tool calling 兼容修复
- 现在的问题不是“框架后端不存在”，而是：
  - `apps/dev-console/backend` 目前只是运行包装壳，项目级资源与落盘位置还不够清晰；
  - 默认种子目前仍主要来自 `packages/runtime-node/src/storage/seed.ts`，不够像“这个 App 自己的测试预设”；
  - 调试台前端目前仍偏 JSON 面板，不够适合直接观察、操作和演示；
  - 用户要求把测试项目真正做成“框架功能验证台”，而不是只看一层通用壳。

## 任务边界
- 本轮主改动范围：
  - `apps/dev-console`
  - `apps/dev-console/backend`
  - `scripts/run-runtime-node-app.mjs`
  - `packages/runtime-node` 中与路径解析、seed/preset、可观测接口配合相关的必要部分
  - 文档与项目记忆文件
- 不恢复用户已经明确删除的旧 `apps/dev-console/backend/presets/mededu-default-v1/*`。
- 不把 `apps/dev-console` 做成业务产品，而是做成“框架测试与演示项目”。

## 执行目标（当前状态）
1. 修正项目级后端落盘与隔离（已完成）
- 确保 `apps/dev-console` 的 SQLite、日志、可观测数据、后续 preset 都落在 `apps/dev-console/backend/` 自己目录下；
- 修正当前实际落盘到仓库根 `data/` 的问题；
- 明确 dev-console backend 的真实目录职责，不再让人误以为“没有后端”。

2. 为 dev-console 建立专属测试 preset（已完成）
- 不再只依赖 `runtime-node` 的默认 `seed.ts`；
- 在 `apps/dev-console/backend/presets/` 下创建新的测试 preset；
- 预设至少覆盖：
  - 多 agent
  - 多 prompt unit
  - workflow / handoff
  - 默认 builtin tools
  - 至少一个 MCP/skill 测试入口（若不依赖外部 API，则优先走本地可用方案）
- 预设主题按用户要求设计为“医学诊疗训练 + 评判 + 科研辅助 + 编排器”。

3. 让测试 preset 真正体现框架能力（第一版已完成，后续继续补强）
- 角色至少包括：
  - 患者 agent：低配合度、容易跑题的老太太
  - 医学生身份上下文 / user 身份牌
  - 临床诊疗导师
  - 科研助手
  - 评判者 / 打分者
  - 编排器
- 明确各 agent：
  - prompt unit 绑定
  - toolAllowList
  - handoff 策略
  - workflow 节点与边
- 尽量让一次真实 run 能体现：
  - PromptUnit 组装
  - handoff
  - tool calling
  - trace / side effect / state diff
  - 审批 / 中断 / fork 的后续观察面

4. 调试台前端升级为真正可读、可操作的 UI（第一版已完成，后续继续增强）
- 不再以大块黑底 JSON 作为主要展示方式；
- JSON 仍保留，但退到“原始数据”抽屉或详情视图，不再占主界面主体；
- 主要面板改为结构化 UI 展示：
  - agents 列表
  - workflows 节点/边视图
  - prompt units 列表与详情
  - traces / side effects / approvals / history 的人类可读视图
  - tool exposure / system config 的结构化展示
- 不丢字段：
  - UI 展示必须尽量覆盖原始数据，不允许“解析后只剩两项，其他八项全没了”。

5. 加入调试台特有的编辑交互（第一版已完成，后续继续增强）
- 支持在 agent 定义里查看 prompt unit 绑定顺序；
- 支持通过拖拽或等价的顺序控制方式调整 prompt unit 顺序；
- 支持开关某个 prompt unit 是否启用；
- 支持看到 prompt unit 插入位置（例如 system/task/tool context 等）；
- 若本轮拖拽实现成本过高，至少先做：
  - 顺序上移/下移
  - 启用/禁用
  - 插入位置与 trigger 的可视化展示
- 新增要求（2026-04-02 用户补充）：
  - `dev-console` 不是纯展示台，而是控制台；
  - 前端必须支持修改 / 新增：
    - prompt unit
    - agent
    - workflow
  - 允许采用“结构化表单 + 高级 JSON 编辑”混合方案，但不能只有只读展示。

6. 提升调试台默认可用性（部分完成）
- 把当前实测可用的 DeepSeek 配置作为 dev-console 默认测试配置写入前端默认值；
- 目标是减少每次打开都重新填写 `baseURL / model / vendor / apiMode` 的重复操作；
- `apiKey` 默认值是否写入仓库需要谨慎：
  - 不把用户明文密钥提交进 git；
  - 可以预留本地存储、环境变量或开发时默认填充机制，但不能把已暴露密钥继续固化到代码库。

7. 补齐“预设 / 定义参考文档”（当前进行中）
- 现有《基于SimpleAgent框架开发App指南》偏向“如何接框架运行时”，还不够回答“二次开发时到底有哪些可定义块、每个 JSON 能写哪些键、效果是什么”。
- 需要新增一份更贴近 preset / setup 的参考文档，至少覆盖：
  - PromptUnit / PromptBlock
  - Agent
  - Workflow
  - Tools / Builtin Tool Config
  - Memory / Catalog Memory Facet
  - MCP / Skill / Integration Facet
- 目标不是完整 JSON Schema 转储，而是：
  - 常用字段解释
  - 可选值范围
  - 推荐写法
  - 字段变化会导致什么运行结果
  - 最小示例

## 分阶段计划
1. 后端隔离修正
- 复盘 `INIT_CWD / dataDir / presetDir` 当前解析链；
- 修正 dev-console 数据目录落盘到仓库根的问题；
- 验证 SQLite 实际出现在 `apps/dev-console/backend/data/`；
- 验证 run、trace、catalog、approval 等都写入该项目自己的库。

2. dev-console preset 建设
- 在 `apps/dev-console/backend/presets/` 下建立新 preset；
- 写入测试用 prompt units / agents / workflows / tools（必要时加 catalog 初始化逻辑）；
- 让 backend 包装默认加载该 preset；
- 验证首次启动时项目数据按该 preset 入库。

3. 前端可视化重构
- 重构首页布局，弱化纯 JSON；
- 把库存、workflow、trace、history、catalog 拆成结构化面板；
- 增加“原始 JSON”折叠区，作为完整字段兜底；
- 清理当前不利于阅读的黑框展示。

## 已完成进展（2026-04-01，最新）
- 已完成：`scripts/run-runtime-node-app.mjs` 现在会基于 backend 包自身目录解析 `dataDir / presetDir`，不再把 `./data` 错落到仓库根目录。
- 已完成：`apps/dev-console/backend/package.json` 默认加载 `./presets/medical-training-bench-v1`。
- 已完成：`apps/dev-console/backend/presets/medical-training-bench-v1/` 第一版预设已经建立，包含：
  - 5 个 app 专属 agent
  - 9 个 app 专属 prompt units
  - 1 个 app 专属 workflow
- 已完成：`apps/dev-console/src/App.tsx` 默认 provider 已切到 DeepSeek 兼容配置，并优先选择 `workflow.devconsole.medical_training_bench`。
- 已完成：调试台前端主界面已从“以大块 JSON 为主”升级为“结构化工作台 + 原始 JSON 折叠兜底”。
- 已完成：前端现在可以直接操作部分框架配置：
  - 调整 agent 内 prompt binding 顺序
  - 启用 / 禁用某个 prompt binding
  - 启用 / 禁用 builtin tool
  - 处理 approval 请求
- 已完成：控制台第一版配置编辑器已接通：
  - 可以载入当前选中的 prompt unit / agent / workflow
  - 可以复制当前对象为新草稿
  - 可以新建空白草稿
  - 可以通过 `POST / PUT` 新建或更新对象
- 已完成：checkpoint 区已加入 PromptUnit Override 快速生成器，不再只能手写 JSON。
- 下一步重点补齐：正式的配置编辑器
  - 继续把 JSON 编辑器增强成“结构化字段 + 高级 JSON”双模式
  - 继续补 workflow / catalog 更强的可视图编辑
- 已验证：
  - `npm run --workspace @simpagent/dev-console-backend build`
  - `npm run --workspace @simpagent/app-dev-console build`
  - `npm run test`
  - 独立端口启动 `dev-console` backend 后，`/api/agents`、`/api/workflows`、`/api/prompt-blocks` 能读出 app 专属定义
  - `apps/dev-console/backend/data-*/framework.sqlite` 会真实生成

4. PromptUnit / Agent 配置交互
- 在前端展示 agent -> promptBindings；
- 支持顺序调整与启用开关；
- 明确显示 insertion point / order / enabled / trigger 等关键字段；
- 能把改动回写到后端资源定义接口。

5. 完整验证
- 跑 `build`、`test`、dev-console 前后端构建；
- 跑一次真实 DeepSeek 流程；
- 验证 preset、SQLite、catalog、trace、tool calling、handoff、前端展示是否整体可用；
- 若路径或接口层仍有漂移，本轮直接修。

## 本轮完成判据
- `apps/dev-console/backend` 不再只是“概念上的壳”，而是清楚拥有自己的：
  - `data/`
  - `preset/`
  - app 级运行包装说明
- `framework.sqlite` 明确落在 `apps/dev-console/backend/data/`，而不是仓库根 `data/`。
- dev-console 拥有自己的测试 preset，而不是只靠 `runtime-node` 默认 seed 勉强运行。
- 预设能体现：
  - 多角色
  - 多 prompt unit
  - workflow / handoff
  - tools
  - catalog / 可观测性
- 前端主界面不再以纯黑底 JSON 为主，而是结构化 UI + 原始数据兜底。
- prompt unit 的顺序、启用状态、插入位置至少可以直观看到，并具备基础调节能力。

## 风险与注意事项
- 不把用户明文 API key 提交进仓库。
- 不恢复已删除旧 preset，直接新建当前版本的 dev-console preset。
- 若 MCP 真实接入依赖外部服务，则优先采用本地可验证的 skill / mock MCP / 本地 bridge 方案，避免引入新的申请成本。
- 若拖拽交互本轮来不及完成，必须先保证“顺序可调 + 字段可见 + 改动可保存”。
