export interface ModelListResult {
  ids: string[];
  raw: unknown;
}

/**
 * 解析 OpenAI 兼容端点的 GET /models 响应。
 * 标准形态是 { object: "list", data: [{ id, ... }] }，
 * 但不同厂商会有出入，所以只要求 data 是数组、元素带 id。
 */
export function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    throw new Error(`无法解析模型列表响应：${safeStringify(payload)}`);
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error(`模型列表响应里没有 data 数组：${safeStringify(payload)}`);
  }

  const ids: string[] = [];
  for (const entry of data) {
    if (entry && typeof entry === "object") {
      const id = (entry as { id?: unknown }).id;
      if (typeof id === "string" && id !== "") ids.push(id);
    } else if (typeof entry === "string" && entry !== "") {
      ids.push(entry);
    }
  }
  return ids;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return "[无法序列化的响应]";
  }
}
