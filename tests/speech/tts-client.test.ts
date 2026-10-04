import { describe, expect, it } from "vitest";
import { TTS_HTTP_PATH, guessMimeType, previewTtsBody } from "../../src/speech/tts-client";
import { DEFAULT_TTS_VOICE } from "../../src/speech/tts-request";

describe("guessMimeType", () => {
  it("maps the documented formats", () => {
    expect(guessMimeType("mp3")).toBe("audio/mpeg");
    expect(guessMimeType("wav")).toBe("audio/wav");
    expect(guessMimeType("opus")).toBe("audio/opus");
  });

  it("is case-insensitive", () => {
    expect(guessMimeType("MP3")).toBe("audio/mpeg");
  });

  it("falls back to a generic type", () => {
    expect(guessMimeType("aac")).toBe("application/octet-stream");
  });
});

describe("TTS_HTTP_PATH", () => {
  it("matches the documented endpoint", () => {
    expect(TTS_HTTP_PATH).toBe("/api/v1/services/audio/tts/SpeechSynthesizer");
  });
});

describe("previewTtsBody", () => {
  // HTTP 接口必须把待合成文本放在 input.text 里，与 WebSocket 的分段发送不同
  it("includes the text to be synthesized", () => {
    const preview = previewTtsBody(DEFAULT_TTS_VOICE, "The plan is ready.");
    expect(preview).toContain("The plan is ready.");
    expect(preview).toContain("input");
    expect(preview).toContain("voice");
  });

  it("reflects the adjustable parameters", () => {
    const preview = previewTtsBody({ ...DEFAULT_TTS_VOICE, rate: 0.75 }, "hi");
    expect(preview).toContain("0.75");
  });
});
