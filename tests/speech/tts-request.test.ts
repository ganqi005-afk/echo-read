import { describe, expect, it } from "vitest";
import { buildTtsBody, extractAudioUrl } from "../../src/speech/tts-request";

interface TtsBody {
  model: string;
  input: { text: string; voice: string; format: string; sample_rate: number };
}

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

describe("buildTtsBody", () => {
  it("puts text and voice inside input, matching the documented example", () => {
    const body = buildTtsBody({
      model: "qwen-audio-3.0-tts-flash",
      text: "How is the weather today?",
      voice: "longanhuan_v3.6",
    }) as TtsBody;

    expect(body.model).toBe("qwen-audio-3.0-tts-flash");
    expect(body.input.text).toBe("How is the weather today?");
    expect(body.input.voice).toBe("longanhuan_v3.6");
    expect(body.input.format).toBe("mp3");
    expect(body.input.sample_rate).toBe(24000);
  });

  it("honours explicit format and sample rate", () => {
    const body = buildTtsBody({
      model: "m",
      text: "hi",
      voice: "v",
      format: "wav",
      sampleRate: 16000,
    }) as TtsBody;
    expect(body.input.format).toBe("wav");
    expect(body.input.sample_rate).toBe(16000);
  });
});

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
    expect(audio.url).toBe("http://x/y.mp3");
    expect(audio.expiresAt).toBeUndefined();
  });
});
