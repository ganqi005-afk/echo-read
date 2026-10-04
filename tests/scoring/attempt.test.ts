import { describe, expect, it } from "vitest";
import { diffDictation } from "../../src/core/diff";
import { scoreAttempt } from "../../src/scoring/attempt";

const SENTENCE = "The plan is ready.";

describe("scoreAttempt", () => {
  it("gives full marks for a correct attempt at natural speed", () => {
    const diff = diffDictation(SENTENCE, "the plan is ready");
    const score = scoreAttempt(SENTENCE, diff.stats, 1500);
    expect(score.accuracy).toBe(100);
    expect(score.completeness).toBe(100);
    expect(score.fluency).toBe(100);
    expect(score.overall).toBe(100);
  });

  it("counts missing words against completeness", () => {
    const diff = diffDictation(SENTENCE, "the plan ready");
    const score = scoreAttempt(SENTENCE, diff.stats, 1500);
    expect(score.completeness).toBe(75);
    expect(score.accuracy).toBe(75);
  });

  it("penalises a much slower reading", () => {
    const diff = diffDictation(SENTENCE, "the plan is ready");
    expect(scoreAttempt(SENTENCE, diff.stats, 1500).fluency).toBe(100);
    expect(scoreAttempt(SENTENCE, diff.stats, 6000).fluency).toBeLessThan(100);
  });

  it("penalises a much faster reading", () => {
    const diff = diffDictation(SENTENCE, "the plan is ready");
    expect(scoreAttempt(SENTENCE, diff.stats, 400).fluency).toBeLessThan(100);
  });

  it("returns a zero fluency floor for a degenerate duration", () => {
    const diff = diffDictation(SENTENCE, "the plan is ready");
    expect(scoreAttempt(SENTENCE, diff.stats, 0).fluency).toBe(0);
  });

  it("weights overall as accuracy 50 / completeness 30 / fluency 20", () => {
    const diff = diffDictation(SENTENCE, "the plan is ready");
    const score = scoreAttempt(SENTENCE, diff.stats, 1500);
    expect(score.overall).toBe(
      Math.round(score.accuracy * 0.5 + score.completeness * 0.3 + score.fluency * 0.2),
    );
  });

  it("returns all zeros when the reference has no words", () => {
    const diff = diffDictation("", "");
    expect(scoreAttempt("", diff.stats, 1000).overall).toBe(0);
  });
});
