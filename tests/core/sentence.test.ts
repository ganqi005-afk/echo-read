import { describe, expect, it } from "vitest";
import { splitSentences } from "../../src/core/sentence";

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
