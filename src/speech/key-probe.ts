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
 *
 * 判据是「服务端有没有走到业务层」，而不是状态码本身：
 * - 401 / 403 → 鉴权阶段就被拦下 → Key 不可用
 * - 带 request_id 的错误信封（400 / 500 都算）→ 网关已通过鉴权并转发，
 *   后面是业务层或上游的问题 → **说明 Key 是被接受的**
 * - 空的 `{}` → 网关层直接拒绝，什么都没说 → 判断不了
 *
 * 之所以把 500 也算作「已通过鉴权」：实测中探测请求（空 messages）会触发
 * `InternalError: Empty response received from upstream`，这是网关**已经转发**
 * 之后上游才会产生的错误。若 Key 无效，根本走不到这一步。
 */
export function classifyKeyProbe(status: number, body: unknown): KeyProbeOutcome {
  if (status === 401 || status === 403) return "invalid";
  if (status >= 200 && status < 300) return "valid";
  if (looksLikeServiceError(body)) return "valid";
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
      return `鉴权已通过（HTTP ${result.status}）。服务端返回的是业务层或上游的错误 —— 探测请求本来就不完整，出现这个结果是预期内的。`;
    case "invalid":
      return `Key 被拒绝（HTTP ${result.status}）。请检查这把 Key 是否属于当前端点对应的平台与套餐。`;
    default:
      return `无法判断（HTTP ${result.status}）。服务端没有返回可用于判断的内容，通常是网关层直接拒绝。`;
  }
}
