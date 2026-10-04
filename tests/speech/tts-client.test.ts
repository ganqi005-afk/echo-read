import { describe, expect, it } from "vitest";
import { guessMimeType, TTS_HTTP_PATH } from "../../src/speech/tts-client";

describe("guessMimeType", () => {
  it("maps the documented formats", () => {
    expect(guessMimeType("mp3")).toBe("audio/mpeg");
    expect(guessMimeType("wav")).toBe("audio/wav");
  });

  it("is case-insensitive", () => {
    expect(guessMimeType("MP3")).toBe("audio/mpeg");
  });

  it("falls back to a generic type", () => {
    expect(guessMimeType("ogg")).toBe("application/octet-stream");
  });
});

describe("TTS_HTTP_PATH", () => {
  it("matches the documented endpoint", () => {
    expect(TTS_HTTP_PATH).toBe("/api/v1/services/audio/tts/SpeechSynthesizer");
  });
});
