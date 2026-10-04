import { describe, expect, it } from "vitest";
import { listKeySummaries, makeKeyId, migrateKeys } from "../../src/settings/store";

describe("migrateKeys", () => {
  // 旧的加密记录无法在没有口令的情况下还原：留空值，但保住标签，
  // 用户至少知道要重填哪几把，而不是面对一片空白
  it("blanks the value of a legacy encrypted record but keeps its label", () => {
    const migrated = migrateKeys({
      keys: { a: { label: "语音", kind: "standard", blob: { ct: "x" } } },
    });
    expect(migrated.keys?.a.label).toBe("语音");
    expect(migrated.keys?.a.value).toBe("");
  });

  it("keeps an existing plaintext value", () => {
    const migrated = migrateKeys({
      keys: { a: { label: "A", kind: "standard", value: "sk-abc" } },
    });
    expect(migrated.keys?.a.value).toBe("sk-abc");
  });

  it("falls back to the id when a record has no label", () => {
    expect(migrateKeys({ keys: { a: {} } }).keys?.a.label).toBe("a");
  });

  it("returns an empty key list for an empty file", () => {
    expect(migrateKeys({}).keys).toEqual({});
  });
});

describe("makeKeyId", () => {
  it("slugifies a label", () => {
    expect(makeKeyId([], "Token Plan")).toBe("token-plan");
  });

  it("avoids collisions by suffixing", () => {
    expect(makeKeyId(["token-plan"], "Token Plan")).toBe("token-plan-2");
    expect(makeKeyId(["token-plan", "token-plan-2"], "Token Plan")).toBe("token-plan-3");
  });

  it("falls back to a generic id when nothing survives slugifying", () => {
    expect(makeKeyId([], "!!!")).toBe("key");
  });
});

describe("listKeySummaries", () => {
  const file = {
    keys: {
      empty: { label: "空", kind: "standard" as const, value: "" },
      filled: { label: "满", kind: "token-plan" as const, value: "sk-sp-1" },
    },
  };

  it("flags which keys still need a value", () => {
    const byId = new Map(listKeySummaries(file).map((key) => [key.id, key]));
    expect(byId.get("filled")?.hasValue).toBe(true);
    expect(byId.get("empty")?.hasValue).toBe(false);
  });

  it("carries the key kind through for display", () => {
    const byId = new Map(listKeySummaries(file).map((key) => [key.id, key]));
    expect(byId.get("filled")?.kind).toBe("token-plan");
  });
});
