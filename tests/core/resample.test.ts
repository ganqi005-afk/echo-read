import { describe, expect, it } from "vitest";
import { downsample } from "../../src/core/resample";

describe("downsample", () => {
  it("reduces 48k to 16k at one third the length", () => {
    const input = new Float32Array(4800);
    expect(downsample(input, 48000, 16000).length).toBe(1600);
  });

  it("preserves a constant signal", () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = downsample(input, 48000, 16000);
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it("returns a copy when no reduction is needed", () => {
    // 用 float32 能精确表示的值，避免把浮点精度问题误判成逻辑错误
    const input = new Float32Array([0.5, 0.25, 0.75]);
    const out = downsample(input, 16000, 16000);
    expect(Array.from(out)).toEqual([0.5, 0.25, 0.75]);
    expect(out).not.toBe(input);
  });

  it("returns an empty array for empty input", () => {
    expect(downsample(new Float32Array(0), 48000, 16000).length).toBe(0);
  });
});
