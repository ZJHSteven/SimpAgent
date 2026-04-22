/**
 * 真 LLM smoke test 专用配置读取器。
 *
 * 设计目标：
 * 1) 只从本地 `simpagent.toml` 读取真实测试配置，不再依赖环境变量。
 * 2) 复用项目里最简单、最稳定的 key=value TOML 子集，避免引入额外解析器。
 * 3) 明确区分“主运行配置”和“smoke 额外配置”，这样日常服务启动不受影响。
 */
import { readFile } from "node:fs/promises";

type TomlScalar = string | number | boolean;

/**
 * smoke test 需要的独立配置。
 *
 * 说明：
 * - baseUrl / apiKey 默认回退到主配置，便于复用真实模型账号。
 * - chatModel / reasoningModel 必须单独填写，避免 smoke 误把同一个模型当成两类模型。
 */
export interface SmokeTestConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly chatModel: string;
  readonly reasoningModel: string;
}

/**
 * 解析 TOML 标量："字符串" / number / boolean。
 *
 * 这里刻意保持和 runtime-node 里的简化 TOML 语法一致，
 * 这样 `simpagent.toml` 只需要维护一种写法，初学者也更容易理解。
 */
function parseTomlScalar(raw: string): TomlScalar {
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
 * 解析极简 TOML 键值对。
 *
 * 支持能力：
 * - `key = "value"`
 * - `key = 123`
 * - `key = true/false`
 * - 注释行和行尾注释
 *
 * 不支持数组、表和内联表，因为 smoke 配置暂时不需要。
 */
function parseSimpleToml(text: string): Record<string, TomlScalar> {
  const result: Record<string, TomlScalar> = {};

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
 * 把 TOML 里的字段取出来并转成字符串。
 *
 * 说明：
 * - 空字符串仍然视为“没填”。
 * - 这里不做复杂类型转换，因为 smoke 只需要字符串配置。
 */
function readStringField(raw: Record<string, TomlScalar>, key: string): string | undefined {
  const value = raw[key];

  if (value === undefined) {
    return undefined;
  }

  const text = String(value).trim();

  return text.length === 0 ? undefined : text;
}

/**
 * 从 `simpagent.toml` 读取 smoke test 配置。
 *
 * 行为约定：
 * - 如果缺少 `smokeChatModel` 或 `smokeReasoningModel`，直接抛错。
 * - `smokeBaseUrl` / `smokeApiKey` 是可选覆盖项，不填时回退主配置的 `baseUrl` / `apiKey`。
 */
export async function loadSmokeTestConfig(path = "simpagent.toml"): Promise<SmokeTestConfig> {
  const raw = parseSimpleToml(await readFile(path, "utf8"));
  const baseUrl = readStringField(raw, "smokeBaseUrl") ?? readStringField(raw, "baseUrl");
  const apiKey = readStringField(raw, "smokeApiKey") ?? readStringField(raw, "apiKey");
  const chatModel = readStringField(raw, "smokeChatModel");
  const reasoningModel = readStringField(raw, "smokeReasoningModel");

  if (baseUrl === undefined || apiKey === undefined || chatModel === undefined || reasoningModel === undefined) {
    throw new Error(
      "simpagent.toml 必须提供 baseUrl、apiKey、smokeChatModel、smokeReasoningModel；smokeBaseUrl 和 smokeApiKey 可选。"
    );
  }

  return {
    baseUrl,
    apiKey,
    chatModel,
    reasoningModel
  };
}
