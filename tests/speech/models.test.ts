import { describe, expect, it } from "vitest";
import { extractModelIds } from "../../src/speech/models";

describe("extractModelIds", () => {
  it("reads the standard OpenAI models shape", () => {
    const payload = { object: "list", data: [{ id: "a" }, { id: "b" }] };
    expect(extractModelIds(payload)).toEqual(["a", "b"]);
  });

  it("accepts a plain string array", () => {
    expect(extractModelIds({ data: ["x", "y"] })).toEqual(["x", "y"]);
  });

  it("skips entries without a usable id", () => {
    const payload = { data: [{ id: "ok" }, { name: "no-id" }, { id: "" }] };
    expect(extractModelIds(payload)).toEqual(["ok"]);
  });

  it("throws with the raw payload when data is missing", () => {
    expect(() => extractModelIds({ models: [] })).toThrow(/data/);
  });

  it("throws for a non-object payload", () => {
    expect(() => extractModelIds("nope")).toThrow(/无法解析/);
  });
});
