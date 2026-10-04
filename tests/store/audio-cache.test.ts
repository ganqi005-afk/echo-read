import { describe, expect, it } from "vitest";
import { buildCacheKey, toHex } from "../../src/store/audio-cache";

describe("toHex", () => {
  it("renders bytes as two-digit lowercase hex", () => {
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe("000fff");
  });

  it("pads single-digit bytes", () => {
    expect(toHex(new Uint8Array([1]).buffer)).toBe("01");
  });
});

describe("buildCacheKey", () => {
  const base = { text: "Hello.", voice: "v1", model: "m1", format: "mp3" };

  it("is stable for identical inputs", () => {
    expect(buildCacheKey(base)).toBe(buildCacheKey({ ...base }));
  });

  // 这四条是设计文档 12.3 的核心：换任何一项都必须换缓存键
  it("changes when the text changes", () => {
    expect(buildCacheKey({ ...base, text: "Bye." })).not.toBe(buildCacheKey(base));
  });

  it("changes when the voice changes", () => {
    expect(buildCacheKey({ ...base, voice: "v2" })).not.toBe(buildCacheKey(base));
  });

  it("changes when the model changes", () => {
    expect(buildCacheKey({ ...base, model: "m2" })).not.toBe(buildCacheKey(base));
  });

  it("changes when the format changes", () => {
    expect(buildCacheKey({ ...base, format: "wav" })).not.toBe(buildCacheKey(base));
  });

  it("does not collide when fields are shifted across the separator", () => {
    const a = buildCacheKey({ text: "b", voice: "a", model: "m", format: "f" });
    const b = buildCacheKey({ text: "a", voice: "b", model: "m", format: "f" });
    expect(a).not.toBe(b);
  });
});
