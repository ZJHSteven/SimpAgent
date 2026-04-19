#!/usr/bin/env node
/**
 * CLI 应用入口。
 *
 * 功能目标：
 * 1) 从命令行读取用户提示词。
 * 2) 组装 Node runtime（文件、shell、人审）。
 * 3) 执行一次 agent turn，并将流式事件打印到终端。
 */
import {
  IncrementalIdGenerator,
  RuntimeToolExecutor,
  runAgentTurn,
  systemClock,
  type AgentEvent
} from "@simpagent/agent-core";
import {
  CliApprovalRuntime,
  JsonFileTraceStore,
  NodeFileRuntime,
  NodeShellRuntime,
  configToProviderStrategy,
  loadNodeConfig
} from "@simpagent/runtime-node";

/**
 * 从命令行参数中读取 prompt。
 * 规则：
 * - 有参数：按空格拼接为完整输入。
 * - 无参数：使用默认演示提示词，避免 CLI 空跑。
 */
function readPromptFromArgv(): string {
  const prompt = process.argv.slice(2).join(" ").trim();

  if (prompt.length === 0) {
    return "请用一句话介绍 SimpAgent 当前后端能力。";
  }

  return prompt;
}

/**
 * 将 agent 事件按类别输出到终端。
 * - message_delta: 正常回复 token
 * - thinking_delta: 推理 token（调试用途）
 * - tool_approval_requested/tool_result: 工具流程可观测信息
 * - error/done: 结束状态
 */
function printEvent(event: AgentEvent): void {
  if (event.type === "message_delta") {
    // 按 token 增量直接输出，模拟实时打字效果。
    process.stdout.write(event.delta);
    return;
  }

  if (event.type === "thinking_delta") {
    // thinking 单独打标签，便于与最终回复区分。
    process.stdout.write(`\n[thinking] ${event.delta}`);
    return;
  }

  if (event.type === "tool_approval_requested") {
    // 打印工具审批请求，帮助使用者理解“为何卡住等待确认”。
    process.stdout.write(`\n[tool approval] ${event.request.toolCall.name} ${event.request.toolCall.argumentsText}\n`);
    return;
  }

  if (event.type === "tool_result") {
    // 工具返回结果序列化后打印，便于调试工具行为。
    process.stdout.write(`\n[tool result] ${JSON.stringify(event.result.content)}\n`);
    return;
  }

  if (event.type === "error") {
    // error 走 stderr，和正常输出流分离。
    process.stderr.write(`\n[error] ${event.errorCode}: ${event.message}\n`);
    return;
  }

  if (event.type === "done") {
    // turn 正常结束标记。
    process.stdout.write("\n[done]\n");
  }
}

/**
 * CLI 主流程：
 * 1) 读取配置
 * 2) 装配 runtime 与 trace store
 * 3) 调用 runAgentTurn 执行一次完整回合
 */
async function main(): Promise<void> {
  // 从 simpagent.toml 读取 provider、审批策略、存储路径等配置。
  const config = await loadNodeConfig();
  // Node 文件工具实现。
  const fileRuntime = new NodeFileRuntime();
  // Node shell 工具实现。
  const shellRuntime = new NodeShellRuntime();
  // CLI 场景下使用同步终端审批。
  const approvalRuntime = new CliApprovalRuntime();
  // 聚合为 core 期望的 runtime 结构。
  const runtime = { fileRuntime, shellRuntime, approvalRuntime };
  // 生成 run/thread/turn/message 等递增 ID。
  const idGenerator = new IncrementalIdGenerator();
  // trace 持久化到本地配置目录。
  const traceStore = new JsonFileTraceStore(config.storageDir);

  await runAgentTurn({
    // 每次执行都创建新的 run/thread/turn 标识。
    runId: idGenerator.nextId("run"),
    threadId: idGenerator.nextId("thread"),
    turnId: idGenerator.nextId("turn"),
    // CLI 首版不复用历史消息，直接空上下文起步。
    messages: [],
    // 用户输入（来自 argv 或默认文案）。
    userText: readPromptFromArgv(),
    // 把 node config 映射为 provider strategy。
    strategy: configToProviderStrategy(config),
    // 内置工具执行器，底层委派给 runtime。
    toolExecutor: new RuntimeToolExecutor(runtime),
    runtime,
    traceStore,
    // 运行在 Node 18+ 全局 fetch 上。
    fetchFn: fetch,
    // 使用系统时钟记录时延指标。
    clock: systemClock,
    idGenerator,
    // 按配置控制 ask/deny/always_approve。
    approvalPolicy: config.approvalPolicy,
    // 所有流式事件统一走 printEvent。
    onEvent: printEvent
  });
}

/**
 * 进程级兜底错误处理，保证 CLI 出错时有可读信息和非 0 退出码。
 */
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[fatal] ${message}\n`);
  process.exitCode = 1;
});

