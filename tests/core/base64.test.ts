import { describe, expect, it } from "vitest";
import { bytesToBase64, bytesToDataUri } from "../../src/core/base64";

describe("bytesToBase64", () => {
  it("matches the platform encoder for a short input", () => {
    const bytes = new Uint8Array([104, 105]);
    expect(bytesToBase64(bytes)).toBe(btoa("hi"));
  });

  it("handles input larger than the chunk size", () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const encoded = bytesToBase64(bytes);
    expect(encoded.length).toBe(Math.ceil(bytes.length / 3) * 4);
  });

  it("encodes an empty array as an empty string", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});

describe("bytesToDataUri", () => {
  it("prefixes the mime type", () => {
    const uri = bytesToDataUri(new Uint8Array([1, 2, 3]), "audio/wav");
    expect(uri.startsWith("data:audio/wav;base64,")).toBe(true);
  });
});
