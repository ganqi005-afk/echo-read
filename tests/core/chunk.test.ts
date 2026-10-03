import { describe, expect, it } from "vitest";
import { countWords, splitChunks } from "../../src/core/chunk";

const LONG =
  "The committee decided to postpone the proposal until next spring, " +
  "because the data collected during the pilot phase was incomplete and " +
  "the timeline that had been proposed by the vendor was unrealistic.";

describe("countWords", () => {
  it("counts word tokens, not spaces", () => {
    expect(countWords("well-known idea, really")).toBe(3);
  });
});

describe("splitChunks", () => {
  it("returns a short sentence untouched", () => {
    expect(splitChunks("Short one.")).toEqual(["Short one."]);
  });

  it("splits at the comma", () => {
    const parts = splitChunks(LONG);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].endsWith(",")).toBe(true);
  });

  it("never exceeds the word limit", () => {
    for (const part of splitChunks(LONG, { maxWords: 12 })) {
      expect(countWords(part)).toBeLessThanOrEqual(12);
    }
  });

  it("preserves the word sequence when rejoined", () => {
    const before = LONG.match(/[A-Za-z0-9'\u2019-]+/g);
    const after = splitChunks(LONG)
      .join(" ")
      .match(/[A-Za-z0-9'\u2019-]+/g);
    expect(after).toEqual(before);
  });

  it("merges fragments shorter than the minimum", () => {
    const parts = splitChunks("Yes, and the rest of this sentence is long enough.", {
      minWords: 5,
    });
    expect(parts.every((p) => countWords(p) >= 5)).toBe(true);
  });

  it("returns an empty array for blank input", () => {
    expect(splitChunks("  ")).toEqual([]);
  });
});
