import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptString, encryptString } from "../../src/store/secrets";

globalThis.crypto ??= webcrypto as unknown as Crypto;

const ITERATIONS = 1000;

describe("encryptString / decryptString", () => {
  it("round-trips a secret", async () => {
    const blob = await encryptString("sk-abcdef123456", "correct horse", ITERATIONS);
    await expect(decryptString(blob, "correct horse")).resolves.toBe("sk-abcdef123456");
  });

  it("produces a different ciphertext every time", async () => {
    const a = await encryptString("same", "pw", ITERATIONS);
    const b = await encryptString("same", "pw", ITERATIONS);
    expect(a.ct).not.toBe(b.ct);
  });

  it("never stores the plaintext", async () => {
    const blob = await encryptString("sk-abcdef123456", "correct horse", ITERATIONS);
    expect(JSON.stringify(blob)).not.toContain("sk-abcdef123456");
  });

  it("rejects a wrong passphrase", async () => {
    const blob = await encryptString("sk-abcdef123456", "correct horse", ITERATIONS);
    await expect(decryptString(blob, "wrong horse")).rejects.toThrow();
  });
});
