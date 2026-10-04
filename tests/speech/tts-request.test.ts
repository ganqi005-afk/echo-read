import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTS_VOICE,
  buildTtsBody,
  extractAudioUrl,
  voiceSignature,
  type TtsVoice,
} from "../../src/speech/tts-request";

function voice(overrides: Partial<TtsVoice> = {}): TtsVoice {
  return { ...DEFAULT_TTS_VOICE, ...overrides };
}

interface Body {
  model: string;
  input: Record<string, unknown>;
}

const LEGACY_SEPARATOR = "\u0000";

describe("buildTtsBody", () => {
  it("puts text and voice inside input, matching the documented example", () => {
    const body = buildTtsBody(voice(), "How is the weather today?") as Body;
    expect(body.model).toBe(DEFAULT_TTS_VOICE.model);
    expect(body.input.text).toBe("How is the weather today?");
    expect(body.input.voice).toBe(DEFAULT_TTS_VOICE.voice);
    expect(body.input.format).toBe("mp3");
    expect(body.input.sample_rate).toBe(24000);
  });

  // 数值参数显式传入，避免服务端默认值变更时行为漂移
  it("always sends the numeric controls explicitly", () => {
    const body = buildTtsBody(voice({ rate: 0.8, volume: 70, pitch: 1.1 }), "hi") as Body;
    expect(body.input.rate).toBe(0.8);
    expect(body.input.volume).toBe(70);
    expect(body.input.pitch).toBe(1.1);
  });

  it("omits blank instruction and language rather than sending empty strings", () => {
    const body = buildTtsBody(voice({ instruction: "   ", language: "" }), "hi") as Body;
    expect("instruction" in body.input).toBe(false);
    expect("language" in body.input).toBe(false);
  });

  it("sends instruction and language when provided", () => {
    const body = buildTtsBody(
      voice({ instruction: "用缓慢清晰的语气朗读", language: "en" }),
      "hi",
    ) as Body;
    expect(body.input.instruction).toBe("用缓慢清晰的语气朗读");
    expect(body.input.language).toBe("en");
  });

  it("trims the instruction before sending", () => {
    const body = buildTtsBody(voice({ instruction: "  慢一点  " }), "hi") as Body;
    expect(body.input.instruction).toBe("慢一点");
  });
});

describe("voiceSignature", () => {
  it("is stable for identical voices", () => {
    expect(voiceSignature(voice())).toBe(voiceSignature(voice()));
  });

  /**
   * 这条测试防的是真实的金钱损失：签名一旦与旧版不一致，
   * 用户已经付过费生成的缓存会全部失配，等于重新买一遍。
   */
  it("reproduces the legacy cache key at default parameters", () => {
    const legacy = [
      DEFAULT_TTS_VOICE.model,
      DEFAULT_TTS_VOICE.voice,
      DEFAULT_TTS_VOICE.format,
    ].join(LEGACY_SEPARATOR);
    expect(voiceSignature(voice())).toBe(legacy);
  });

  it("changes for every adjustable parameter", () => {
    const base = voiceSignature(voice());
    expect(voiceSignature(voice({ voice: "other" }))).not.toBe(base);
    expect(voiceSignature(voice({ format: "wav" }))).not.toBe(base);
    expect(voiceSignature(voice({ sampleRate: 48000 }))).not.toBe(base);
    expect(voiceSignature(voice({ rate: 0.8 }))).not.toBe(base);
    expect(voiceSignature(voice({ volume: 60 }))).not.toBe(base);
    expect(voiceSignature(voice({ pitch: 1.2 }))).not.toBe(base);
    expect(voiceSignature(voice({ instruction: "慢一点" }))).not.toBe(base);
    expect(voiceSignature(voice({ language: "en" }))).not.toBe(base);
  });

  it("ignores a whitespace-only instruction so it cannot fork the cache", () => {
    expect(voiceSignature(voice({ instruction: "   " }))).toBe(voiceSignature(voice()));
  });
});

const SAMPLE_RESPONSE = {
  request_id: "ee88b03d",
  output: {
    finish_reason: "stop",
    audio: {
      data: "",
      url: "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/pre/x.wav?sig=abc",
      id: "audio_ee88b03d",
      expires_at: 1772697707,
    },
  },
  usage: { characters: 15 },
};

describe("extractAudioUrl", () => {
  it("reads the url and expiry from the documented response", () => {
    const audio = extractAudioUrl(SAMPLE_RESPONSE);
    expect(audio.url).toContain("dashscope-result-bj");
    expect(audio.expiresAt).toBe(1772697707);
  });

  it("throws when audio is missing", () => {
    expect(() => extractAudioUrl({ output: {} })).toThrow(/audio/);
  });

  it("throws when the url is empty", () => {
    expect(() => extractAudioUrl({ output: { audio: { url: "" } } })).toThrow(/音频地址/);
  });

  it("tolerates a response without expires_at", () => {
    const audio = extractAudioUrl({ output: { audio: { url: "http://x/y.mp3" } } });
    expect(audio.expiresAt).toBeUndefined();
  });
});
