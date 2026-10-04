import { describe, expect, it } from "vitest";
import {
  guessMimeType,
  previewTtsBody,
  resolveTtsEndpoint,
} from "../../src/speech/tts-client";
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

describe("resolveTtsEndpoint", () => {
  const base = "https://maas.qianwenaiapi.com";

  it("uses the speech-synthesizer path for Qwen-Audio-TTS", () => {
    expect(resolveTtsEndpoint(base, "qwen-audio-3.0-tts-flash")).toBe(
      `${base}/api/v1/services/audio/tts/SpeechSynthesizer`,
    );
  });

  // 官方明确"端点不可混用"：用错端点只会拿到一个没有说明的 400
  it("switches to the multimodal path for Qwen-TTS", () => {
    expect(resolveTtsEndpoint(base, "qwen3-tts-flash")).toBe(
      `${base}/api/v1/services/aigc/multimodal-generation/generation`,
    );
  });

  it("switches to the multimodal path for MiniMax", () => {
    expect(resolveTtsEndpoint(base, "MiniMax/speech-2.8-hd")).toBe(
      `${base}/api/v1/services/aigc/multimodal-generation/generation`,
    );
  });

  it("keeps the speech-synthesizer path for CosyVoice", () => {
    expect(resolveTtsEndpoint(base, "cosyvoice-v3-flash")).toBe(
      `${base}/api/v1/services/audio/tts/SpeechSynthesizer`,
    );
  });

  it("tolerates a trailing slash in the base url", () => {
    expect(resolveTtsEndpoint(`${base}/`, "qwen-audio-3.0-tts-flash")).toBe(
      `${base}/api/v1/services/audio/tts/SpeechSynthesizer`,
    );
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
