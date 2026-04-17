/**
 * 本文件负责读取并解析 Node 端配置（simpagent.toml）。
 * 说明：当前实现是“简化 TOML 子集解析器”，仅覆盖项目所需键值场景。
 */
import { readFile } from "node:fs/promises";
import type { ApprovalPolicy, ApiProviderKind, ProviderStrategy } from "@simpagent/agent-core";

/**
 * Node 运行时配置对象。
 */
export interface SimpAgentNodeConfig {
  readonly provider: ApiProviderKind;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly approvalPolicy: ApprovalPolicy;
  readonly storageDir: string;
  readonly timeoutMs: number;
}

/**
 * 解析 TOML 标量："字符串" / number / boolean。
 */
function parseTomlScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  const numeric = Number(trimmed);

  if (Number.isFinite(numeric)) {
    return numeric;
  }

  return trimmed;
}

/**
 * 极简 TOML 解析器：
 * - 支持 key=value
 * - 支持注释行与行尾 # 注释
 * - 不支持数组、表、内联表等高级语法
 */
export function parseSimpleToml(text: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");

    if (index < 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).split("#")[0]?.trim() ?? "";
    result[key] = parseTomlScalar(value);
  }

  return result;
}

/**
 * provider 别名标准化。
 */
function normalizeProvider(value: string): ApiProviderKind {
  if (value === "openai" || value === "openai-chat-completions") {
    return "openai-chat-completions";
  }

  if (value === "deepseek" || value === "deepseek-chat-completions") {
    return "deepseek-chat-completions";
  }

  throw new Error(`不支持的 provider：${value}`);
}

/**
 * 审批策略标准化，默认 ask。
 */
function normalizeApprovalPolicy(value: string | undefined): ApprovalPolicy {
  if (value === undefined || value === "ask") {
    return "ask";
  }

  if (value === "deny" || value === "always_approve") {
    return value;
  }

  throw new Error(`不支持的 approvalPolicy：${value}`);
}

/**
 * 从磁盘加载配置并做基本校验。
 */
export async function loadNodeConfig(path = "simpagent.toml"): Promise<SimpAgentNodeConfig> {
  const raw = parseSimpleToml(await readFile(path, "utf8"));
  const provider = normalizeProvider(String(raw.provider ?? "deepseek"));
  const baseUrl = String(raw.baseUrl ?? "");
  const apiKey = String(raw.apiKey ?? "");
  const model = String(raw.model ?? "");

  if (baseUrl.length === 0 || apiKey.length === 0 || model.length === 0) {
    throw new Error("simpagent.toml 必须提供 baseUrl、apiKey、model。");
  }

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    approvalPolicy: normalizeApprovalPolicy(raw.approvalPolicy === undefined ? undefined : String(raw.approvalPolicy)),
    storageDir: String(raw.storageDir ?? ".simpagent"),
    timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : 60000
  };
}

/**
 * 将 Node 配置映射成 core 侧 provider 策略结构。
 */
export function configToProviderStrategy(config: SimpAgentNodeConfig): ProviderStrategy {
  return {
    id: "provider_default",
    name: config.provider,
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs
  };
}

