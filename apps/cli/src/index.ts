#!/usr/bin/env node
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

function readPromptFromArgv(): string {
  const prompt = process.argv.slice(2).join(" ").trim();

  if (prompt.length === 0) {
    return "请用一句话介绍 SimpAgent 当前后端能力。";
  }

  return prompt;
}

function printEvent(event: AgentEvent): void {
  if (event.type === "message_delta") {
    process.stdout.write(event.delta);
    return;
  }

  if (event.type === "thinking_delta") {
    process.stdout.write(`\n[thinking] ${event.delta}`);
    return;
  }

  if (event.type === "tool_approval_requested") {
    process.stdout.write(`\n[tool approval] ${event.request.toolCall.name} ${event.request.toolCall.argumentsText}\n`);
    return;
  }

  if (event.type === "tool_result") {
    process.stdout.write(`\n[tool result] ${JSON.stringify(event.result.content)}\n`);
    return;
  }

  if (event.type === "error") {
    process.stderr.write(`\n[error] ${event.errorCode}: ${event.message}\n`);
    return;
  }

  if (event.type === "done") {
    process.stdout.write("\n[done]\n");
  }
}

async function main(): Promise<void> {
  const config = await loadNodeConfig();
  const fileRuntime = new NodeFileRuntime();
  const shellRuntime = new NodeShellRuntime();
  const approvalRuntime = new CliApprovalRuntime();
  const runtime = { fileRuntime, shellRuntime, approvalRuntime };
  const idGenerator = new IncrementalIdGenerator();
  const traceStore = new JsonFileTraceStore(config.storageDir);

  await runAgentTurn({
    runId: idGenerator.nextId("run"),
    threadId: idGenerator.nextId("thread"),
    turnId: idGenerator.nextId("turn"),
    messages: [],
    userText: readPromptFromArgv(),
    strategy: configToProviderStrategy(config),
    toolExecutor: new RuntimeToolExecutor(runtime),
    runtime,
    traceStore,
    fetchFn: fetch,
    clock: systemClock,
    idGenerator,
    approvalPolicy: config.approvalPolicy,
    onEvent: printEvent
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[fatal] ${message}\n`);
  process.exitCode = 1;
});

