import { describe, expect, it } from "vitest";
import {
  buildAsrBody,
  buildOpenAiCompatibleBody,
  extractTranscript,
  stripDataUriPrefix,
} from "../../src/speech/asr-request";

interface LooseBody {
  model: string;
  input: { messages: Array<{ role: string; content: Array<{ type: string; input_audio: { data: string } }> }> };
  parameters: { format: string; sample_rate: number };
}

interface OpenAiBody {
  model: string;
  input?: unknown;
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

  it("passes the sample rate through", () => {
    const body = buildAsrBody({
      model: "m",
      audioDataUri: "data:audio/wav;base64,AAAA",
      sampleRate: 16000,
    }) as LooseBody;
    expect(body.parameters.sample_rate).toBe(16000);
  });
});

describe("buildOpenAiCompatibleBody", () => {
  it("strips the data uri prefix and moves the format into its own field", () => {
    const body = buildOpenAiCompatibleBody({
      model: "qwen-audio-3.0-asr-flash",
      audioDataUri: "data:audio/wav;base64,QUJD",
    }) as OpenAiBody;

    expect(body.messages[0].content[0].input_audio.data).toBe("QUJD");
    expect(body.messages[0].content[0].input_audio.format).toBe("wav");
  });

  it("has no DashScope-style input wrapper", () => {
    const body = buildOpenAiCompatibleBody({
      model: "m",
      audioDataUri: "data:audio/wav;base64,QUJD",
    }) as OpenAiBody;
    expect(body.input).toBeUndefined();
  });
});

describe("stripDataUriPrefix", () => {
  it("removes the prefix", () => {
    expect(stripDataUriPrefix("data:audio/wav;base64,QUJD")).toBe("QUJD");
  });

  it("leaves raw base64 untouched", () => {
    expect(stripDataUriPrefix("QUJD")).toBe("QUJD");
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
