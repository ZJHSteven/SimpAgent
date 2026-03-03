# mededu-cockpit

`apps/mededu-cockpit` 是独立的“AI 医学教育前端应用”，用于标书展示与课堂演示。

## 页面结构

1. 左侧：实时会话区（学生 / 虚拟患者 / 专家多角色对话）
2. 中间：可拖拽无限画布（非线性节点与动态连线）
3. 右侧：上下文监控区（指标、时间线、证据卡片、数字人示意）
4. 底部：系统日志区（流程阶段日志）

## 运行方式

在仓库根目录执行：

```bash
# 启动医学教育前端
npm run dev:mededu

# 构建医学教育前端
npm run build:mededu

# 预览构建产物
npm run preview:mededu
```
