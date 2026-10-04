import type { Transport } from "./client";

export type KeyProbeOutcome = "valid" | "invalid" | "unknown";

export interface KeyProbeResult {
  outcome: KeyProbeOutcome;
  status: number;
  detail: string;
}

/**
 * 故意构造一个**参数不完整**的请求体。
 * 目的不是让它成功，而是让它失败得有意义：
 * - Key 无效 → 401/403，服务端在鉴权阶段就拦下了
 * - Key 有效 → 服务端会走到参数校验并报参数错误
 * 这样就能在不发送音频的情况下判断 Key 是否可用。
 */
export function buildProbeBody(model: string, transport: Transport): unknown {
  if (transport === "openai-compatible") {
    return { model, messages: [] };
  }
  return {
    model,
    input: { messages: [] },
    parameters: { format: "wav", sample_rate: "16000" },
  };
}

/**
 * 分类服务端的回应。
 * 注意 400 有两种截然不同的含义：
 * - 带 request_id / code 的 400 → 鉴权已通过，是参数问题 → Key 有效
 * - 空的 `{}` 400 → 网关层就拒了，判断不了 → unknown
 * 这个区分很重要，因为 400 + {} 正是我们踩过的坑。
 */
export function classifyKeyProbe(status: number, body: unknown): KeyProbeOutcome {
  if (status === 401 || status === 403) return "invalid";
  if (status >= 200 && status < 300) return "valid";
  if (status === 400 && looksLikeServiceError(body)) return "valid";
  return "unknown";
}

function looksLikeServiceError(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const node = body as Record<string, unknown>;
  return typeof node.request_id === "string" || typeof node.code === "string";
}

export function describeProbeOutcome(result: KeyProbeResult): string {
  switch (result.outcome) {
    case "valid":
      return `Key 可用（HTTP ${result.status}）。服务端已通过鉴权，返回的是业务层错误 —— 这是预期结果，因为探测请求本来就不完整。`;
    case "invalid":
      return `Key 被拒绝（HTTP ${result.status}）。请检查这把 Key 是否属于当前端点对应的平台与套餐。`;
    default:
      return `无法判断（HTTP ${result.status}）。服务端没有返回可用于判断的内容，通常是网关层直接拒绝。`;
  }
}
