import { describe, expect, it } from "vitest";
import { buildEndpoint, previewRequestBody } from "../../src/speech/client";

const AUDIO = "data:audio/wav;base64,QUJD";

describe("buildEndpoint", () => {
  it("appends the DashScope native path", () => {
    expect(buildEndpoint("https://dashscope.aliyuncs.com", "dashscope-native")).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
  });

  it("appends the OpenAI-compatible path", () => {
    expect(
      buildEndpoint(
        "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        "openai-compatible",
      ),
    ).toBe(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(buildEndpoint("https://example.com/v1/", "openai-compatible")).toBe(
      "https://example.com/v1/chat/completions",
    );
  });
});

describe("previewRequestBody", () => {
  it("keeps the structure but replaces the audio payload", () => {
    const preview = previewRequestBody(
      { transport: "openai-compatible", model: "qwen3-asr-flash" },
      AUDIO,
    );
    expect(preview).toContain("input_audio");
    expect(preview).toContain("qwen3-asr-flash");
    expect(preview).not.toContain("QUJD");
  });

  it("never leaks a key (keys travel in headers, not bodies)", () => {
    const preview = previewRequestBody(
      { transport: "dashscope-native", model: "m" },
      AUDIO,
    );
    expect(preview.toLowerCase()).not.toContain("authorization");
  });
});
