export type ApiKeyKind = "token-plan" | "standard" | "unknown";

/**
 * 只做前缀分类，不返回任何密钥内容。
 * 百炼/千问AI平台的 Token Plan Key 以 sk-sp- 开头，
 * 普通 API Key 以 sk- 开头 —— 两者不能混用。
 */
export function classifyApiKey(key: string): ApiKeyKind {
  const trimmed = key.trim();
  if (trimmed.startsWith("sk-sp-")) return "token-plan";
  if (trimmed.startsWith("sk-")) return "standard";
  return "unknown";
}

export function describeApiKeyKind(kind: ApiKeyKind): string {
  switch (kind) {
    case "token-plan":
      return "Token Plan 型（sk-sp- 开头）";
    case "standard":
      return "普通 API Key 型（sk- 开头）";
    default:
      return "未识别的格式";
  }
}

/**
 * 判断 Key 与端点是否可能匹配。返回 undefined 表示没有发现明显冲突。
 * 这是"提前拦截"，不是鉴权 —— 真正的判断仍然由服务端做。
 */
export function describeKeyEndpointMismatch(
  key: string,
  baseUrl: string,
): string | undefined {
  const kind = classifyApiKey(key);
  const isTokenPlanEndpoint = baseUrl.toLowerCase().includes("token-plan");
  const isCompatibleEndpoint = baseUrl.toLowerCase().includes("compatible-mode");

  if (kind === "token-plan" && !isTokenPlanEndpoint) {
    return "当前 Key 是 Token Plan 型（sk-sp-），但接入地址不是 Token Plan 端点。Token Plan 的 Key 不能用于普通端点，服务端会返回 InvalidApiKey。";
  }
  if (kind === "standard" && isTokenPlanEndpoint) {
    return "当前 Key 是普通型（sk-），但接入地址是 Token Plan 端点。Token Plan 端点需要 sk-sp- 开头的 Key。";
  }
  if (kind === "token-plan" && isTokenPlanEndpoint && !isCompatibleEndpoint) {
    return "Token Plan 端点的文档化路径都带 /compatible-mode/v1，当前地址看起来缺少这一段。";
  }
  return undefined;
}
