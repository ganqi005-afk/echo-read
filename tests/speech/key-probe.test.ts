import { describe, expect, it } from "vitest";
import {
  buildProbeBody,
  classifyKeyProbe,
  describeProbeOutcome,
} from "../../src/speech/key-probe";

describe("buildProbeBody", () => {
  it("sends an intentionally incomplete DashScope body", () => {
    const body = buildProbeBody("m", "dashscope-native") as {
      input: { messages: unknown[] };
    };
    expect(body.input.messages).toEqual([]);
  });

  it("sends an intentionally incomplete OpenAI-compatible body", () => {
    const body = buildProbeBody("m", "openai-compatible") as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });
});

describe("classifyKeyProbe", () => {
  it("treats 401 and 403 as an invalid key", () => {
    expect(classifyKeyProbe(401, { code: "InvalidApiKey" })).toBe("invalid");
    expect(classifyKeyProbe(403, {})).toBe("invalid");
  });

  it("treats a 2xx as valid", () => {
    expect(classifyKeyProbe(200, {})).toBe("valid");
  });

  // 关键区分：同样是 400，带服务端错误信封说明鉴权已过，空 {} 则判断不了
  it("treats a structured 400 as proof the key passed authentication", () => {
    const body = { request_id: "abc", code: "InvalidParameter", message: "messages" };
    expect(classifyKeyProbe(400, body)).toBe("valid");
  });

  it("refuses to guess on an empty 400", () => {
    expect(classifyKeyProbe(400, {})).toBe("unknown");
    expect(classifyKeyProbe(400, undefined)).toBe("unknown");
  });

  // 实测：探测请求会触发 "Empty response received from upstream" 的 500，
  // 那是网关转发之后上游才会报的错，说明 Key 已被接受。
  it("treats a structured 500 as proof the key passed authentication", () => {
    const body = {
      code: "InternalError",
      message: "Empty response received from upstream",
      request_id: "b47cec27",
    };
    expect(classifyKeyProbe(500, body)).toBe("valid");
  });

  it("still reports an unstructured 5xx as unknown", () => {
    expect(classifyKeyProbe(500, {})).toBe("unknown");
  });
});

describe("describeProbeOutcome", () => {
  it("never includes the key", () => {
    const text = describeProbeOutcome({ outcome: "invalid", status: 401, detail: "" });
    expect(text).toContain("401");
    expect(text).not.toContain("sk-");
  });
});
