/**
 * 模型列表 API 适配层。
 *
 * 这个文件的职责很单一：
 * - 向 provider 的 `/models` 端点发请求。
 * - 把返回值解析成稳定的 `ProviderModelListResponse`。
 *
 * 这样前端、server 和 smoke test 都能复用同一套“获取可用模型”的逻辑。
 */
import type {
  FetchLike,
  ProviderModelInfo,
  ProviderModelListResponse,
  ProviderStrategy
} from "../types/api.js";

/**
 * 去掉 baseUrl 尾部多余斜杠，避免路径拼接出现 `//models`。
 */
function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * 计算模型列表接口地址。
 *
 * 说明：
 * - 这里沿用项目现有的简化约定：`baseUrl` 只要能拼出 `/models` 就行。
 * - 当前 smoke 以及 server 默认配置都使用 `https://api.deepseek.com` 这一类 baseUrl。
 */
function buildModelsUrl(baseUrl: string): string {
  return `${trimSlash(baseUrl)}/models`;
}

/**
 * 轻量判断一个值是不是普通对象。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取 provider 的模型列表。
 *
 * 输入：
 * - strategy: 包含 baseUrl / apiKey 的 provider 快照。
 * - fetchFn: 可注入的 fetch，便于测试。
 *
 * 输出：
 * - 标准化后的模型列表响应。
 *
 * 异常：
 * - HTTP 状态码非 2xx 会直接抛错。
 * - 返回体不符合最小结构时也会抛错，避免把坏数据继续扩散到前端。
 */
export async function listProviderModels(input: {
  readonly strategy: ProviderStrategy;
  readonly fetchFn: FetchLike;
}): Promise<ProviderModelListResponse> {
  const response = await input.fetchFn(buildModelsUrl(input.strategy.baseUrl), {
    method: "GET",
    headers: {
      authorization: `Bearer ${input.strategy.apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`获取模型列表失败：HTTP ${response.status}`);
  }

  const payload = (await response.json()) as unknown;

  if (!isPlainObject(payload) || payload.object !== "list" || !Array.isArray(payload.data)) {
    throw new Error("模型列表响应格式不正确。");
  }

  const data: ProviderModelInfo[] = [];

  for (const item of payload.data) {
    if (
      !isPlainObject(item) ||
      typeof item.id !== "string" ||
      item.object !== "model" ||
      typeof item.owned_by !== "string"
    ) {
      continue;
    }

    data.push({
      id: item.id,
      object: "model",
      owned_by: item.owned_by
    });
  }

  return {
    object: "list",
    data
  };
}
