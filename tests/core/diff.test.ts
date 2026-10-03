import { describe, expect, it } from "vitest";
import { diffDictation, tokenize } from "../../src/core/diff";

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("The committee's plan, really?")).toEqual([
      "the", "committee's", "plan", "really",
    ]);
  });
});

describe("diffDictation", () => {
  it("scores a perfect attempt as 100", () => {
    const r = diffDictation("The plan is ready.", "the plan is ready");
    expect(r.stats.accuracy).toBe(100);
    expect(r.stats.missing + r.stats.extra + r.stats.wrong).toBe(0);
  });

  it("ignores case and punctuation", () => {
    const r = diffDictation("The plan is ready.", "THE PLAN IS READY!!!");
    expect(r.stats.accuracy).toBe(100);
  });

  it("marks a dropped word as missing", () => {
    const r = diffDictation("The plan is ready.", "The plan ready");
    expect(r.stats.missing).toBe(1);
    expect(r.stats.accuracy).toBe(75);
  });

  it("marks an added word as extra", () => {
    const r = diffDictation("The plan is ready.", "The plan is very ready");
    expect(r.stats.extra).toBe(1);
  });

  it("marks a substituted word as wrong", () => {
    const r = diffDictation("The plan is ready.", "The plan is steady");
    expect(r.stats.wrong).toBe(1);
    expect(r.stats.correct).toBe(3);
  });

  it("accepts British and American spellings", () => {
    expect(diffDictation("The colour is fine.", "the color is fine").stats.accuracy).toBe(100);
  });

  it("accepts digits written as number words", () => {
    expect(diffDictation("There are 3 options.", "there are three options").stats.accuracy).toBe(100);
  });

  it("accepts hyphenated and unhyphenated forms", () => {
    expect(diffDictation("Send an e-mail today.", "send an email today").stats.accuracy).toBe(100);
  });

  it("returns zero accuracy for an empty attempt", () => {
    expect(diffDictation("The plan is ready.", "").stats.accuracy).toBe(0);
  });
});
