import { describe, expect, it } from "vitest";
import { splitSentenceRanges, splitSentences } from "../../src/core/sentence";

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(splitSentences("Hello world. How are you?")).toEqual([
      "Hello world.",
      "How are you?",
    ]);
  });

  it("does not split on titles and abbreviations", () => {
    expect(splitSentences("Dr. Smith moved to the U.S. He stayed.")).toEqual([
      "Dr. Smith moved to the U.S.",
      "He stayed.",
    ]);
  });

  it("does not split decimals", () => {
    expect(splitSentences("It costs 3.14 dollars. Fine.")).toEqual([
      "It costs 3.14 dollars.",
      "Fine.",
    ]);
  });

  it("keeps a closing quote with its sentence", () => {
    expect(splitSentences('He said "Go." Then left.')).toEqual([
      'He said "Go."',
      "Then left.",
    ]);
  });

  it("treats a run of enders as one break", () => {
    expect(splitSentences("Wait... really? Yes!")).toEqual([
      "Wait...",
      "really?",
      "Yes!",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("splitSentenceRanges", () => {
  it("returns offsets that slice back to the sentence text", () => {
    const text = "Hello world. How are you?";
    for (const range of splitSentenceRanges(text)) {
      expect(text.slice(range.start, range.end)).toBe(range.text);
    }
  });

  it("reports the expected ranges for a two-sentence paragraph", () => {
    // "Hello world." 是 12 个字符（0-11），空格在 12，"How are you?" 是 12 个字符（13-24）
    expect(splitSentenceRanges("Hello world. How are you?")).toEqual([
      { start: 0, end: 12, text: "Hello world." },
      { start: 13, end: 25, text: "How are you?" },
    ]);
  });

  // 装饰时要按原始文本切分，因此范围版本不能归一化内部空白
  it("preserves interior whitespace rather than normalising it", () => {
    const text = "First  line.\nSecond line.";
    const ranges = splitSentenceRanges(text);
    expect(ranges[0].text).toBe("First  line.");
    expect(ranges[1].text).toBe("Second line.");
    expect(text.slice(ranges[1].start, ranges[1].end)).toBe("Second line.");
  });

  it("still applies the abbreviation rules", () => {
    const ranges = splitSentenceRanges("Dr. Smith moved to the U.S. He stayed.");
    expect(ranges.map((r) => r.text)).toEqual([
      "Dr. Smith moved to the U.S.",
      "He stayed.",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(splitSentenceRanges("   ")).toEqual([]);
  });
});
