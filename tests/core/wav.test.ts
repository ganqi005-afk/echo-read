import { describe, expect, it } from "vitest";
import { encodeWav } from "../../src/core/wav";

function ascii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

describe("encodeWav", () => {
  it("writes a valid 44-byte RIFF header", () => {
    const view = new DataView(encodeWav(new Float32Array(0), 16000));
    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("reports sizes consistent with the sample count", () => {
    const view = new DataView(encodeWav(new Float32Array(100), 16000));
    expect(view.byteLength).toBe(44 + 200);
    expect(view.getUint32(4, true)).toBe(36 + 200);
    expect(view.getUint32(40, true)).toBe(200);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
  });

  it("clamps out-of-range samples instead of wrapping", () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2]), 16000));
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("rounds a zero signal to silence", () => {
    const view = new DataView(encodeWav(new Float32Array([0, 0]), 16000));
    expect(view.getInt16(44, true)).toBe(0);
  });
});
