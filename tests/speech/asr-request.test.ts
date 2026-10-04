import { describe, expect, it } from "vitest";
import {
  buildAsrBody,
  buildOpenAiCompatibleBody,
  extractTranscript,
} from "../../src/speech/asr-request";

interface LooseBody {
  model: string;
  input: { messages: Array<{ role: string; content: Array<{ type: string; input_audio: { data: string } }> }> };
  parameters: { format: string; sample_rate: string };
}

interface OpenAiBody {
  model: string;
  input?: unknown;
  stream?: boolean;
  messages: Array<{
    role: string;
    content: Array<{ type: string; input_audio: { data: string; format: string } }>;
  }>;
}

describe("buildAsrBody", () => {
  it("wraps the audio data uri in the multimodal message shape", () => {
    const body = buildAsrBody({
      model: "qwen-audio-3.0-asr-flash",
      audioDataUri: "data:audio/wav;base64,AAAA",
    }) as LooseBody;

    expect(body.model).toBe("qwen-audio-3.0-asr-flash");
    expect(body.input.messages[0].role).toBe("user");
    expect(body.input.messages[0].content[0].type).toBe("input_audio");
    expect(body.input.messages[0].content[0].input_audio.data).toBe(
      "data:audio/wav;base64,AAAA",
    );
    expect(body.parameters.format).toBe("wav");
  });

  // 官方 HTTP API 示例里写的是 "sample_rate": "16000"（带引号）。
  // 这是逐字对齐文档，不是笔误 —— 类型不符会让服务端直接拒绝。
  it("sends the sample rate as a string, matching the documented example", () => {
    const body = buildAsrBody({
      model: "m",
      audioDataUri: "data:audio/wav;base64,AAAA",
      sampleRate: 16000,
    }) as LooseBody;
    expect(body.parameters.sample_rate).toBe("16000");
    expect(typeof body.parameters.sample_rate).toBe("string");
  });
});

describe("buildOpenAiCompatibleBody", () => {
  // 依据百炼「OpenAI 兼容-Chat」与「Qwen-ASR API 参考」：
  // input_audio.data 要求传 Base64 Data URL（带 data: 前缀），
  // 而不是 OpenAI 官方规范里的纯 base64。剥掉前缀会导致 HTTP 400。
  it("keeps the full Data URL in the data field", () => {
    const body = buildOpenAiCompatibleBody({
      model: "qwen-audio-3.0-asr-flash",
      audioDataUri: "data:audio/wav;base64,QUJD",
    }) as OpenAiBody;

    expect(body.messages[0].content[0].input_audio.data).toBe(
      "data:audio/wav;base64,QUJD",
    );
    expect(body.messages[0].content[0].input_audio.format).toBe("wav");
  });

  it("disables streaming, matching the documented example", () => {
    const body = buildOpenAiCompatibleBody({
      model: "m",
      audioDataUri: "data:audio/wav;base64,QUJD",
    }) as OpenAiBody;
    expect(body.stream).toBe(false);
  });

  it("has no DashScope-style input wrapper", () => {
    const body = buildOpenAiCompatibleBody({
      model: "m",
      audioDataUri: "data:audio/wav;base64,QUJD",
    }) as OpenAiBody;
    expect(body.input).toBeUndefined();
  });
});

describe("extractTranscript", () => {
  it("reads the multimodal choices shape", () => {
    const payload = {
      output: { choices: [{ message: { content: [{ text: "hello world" }] } }] },
    };
    expect(extractTranscript(payload)).toBe("hello world");
  });

  it("reads a plain output.text shape", () => {
    expect(extractTranscript({ output: { text: "hello" } })).toBe("hello");
  });

  it("reads a string content shape", () => {
    const payload = { output: { choices: [{ message: { content: "hi there" } }] } };
    expect(extractTranscript(payload)).toBe("hi there");
  });

  it("reads the filetrans transcripts shape", () => {
    const payload = { output: { results: [{ transcription: "from filetrans" }] } };
    expect(extractTranscript(payload)).toBe("from filetrans");
  });

  it("throws with the raw payload when nothing matches", () => {
    expect(() => extractTranscript({ output: { unexpected: 1 } })).toThrow(/unexpected/);
  });

  it("reads top-level choices from an OpenAI-compatible payload", () => {
    const payload = { choices: [{ message: { content: "openai style" } }] };
    expect(extractTranscript(payload)).toBe("openai style");
  });
});
