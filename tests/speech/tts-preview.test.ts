import { describe, expect, it } from "vitest";
import { previewTtsBody } from "../../src/speech/tts-client";

describe("previewTtsBody", () => {
  const options = {
    baseUrl: "https://maas.qianwenaiapi.com",
    apiKey: "sk-should-never-appear",
    model: "qwen-audio-3.0-tts-flash",
    voice: "longanhuan_v3.6",
  };

  // HTTP 接口必须把待合成文本放在 input.text 里，与 WebSocket 的分段发送不同
  it("includes the text to be synthesized", () => {
    const preview = previewTtsBody(options, "The plan is ready.");
    expect(preview).toContain("The plan is ready.");
    expect(preview).toContain("input");
    expect(preview).toContain("voice");
  });

  it("never leaks the API key", () => {
    expect(previewTtsBody(options, "hi")).not.toContain("sk-should-never-appear");
  });
});
