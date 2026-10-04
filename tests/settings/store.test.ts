import { describe, expect, it } from "vitest";
import {
  listKeySummaries,
  makeKeyId,
  migrateSecrets,
  type SecretsFile,
} from "../../src/settings/store";
import type { SecretBlob } from "../../src/store/secrets";

const BLOB: SecretBlob = {
  v: 1,
  kdf: "PBKDF2-SHA256",
  iter: 1,
  salt: "a",
  iv: "b",
  ct: "c",
};

describe("migrateSecrets", () => {
  it("moves a legacy single key into the named list", () => {
    const migrated = migrateSecrets({ bailianApiKey: BLOB });
    expect(Object.keys(migrated.keys ?? {})).toEqual(["legacy"]);
    expect(migrated.keys?.legacy.blob).toBe(BLOB);
  });

  it("leaves an already-migrated file untouched", () => {
    const file: SecretsFile = { keys: { a: { label: "A", kind: "standard", blob: BLOB } } };
    expect(migrateSecrets(file)).toBe(file);
  });

  it("returns an empty key list for an empty file", () => {
    expect(migrateSecrets({}).keys).toEqual({});
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
  it("lists id, label and kind sorted by label", () => {
    const file: SecretsFile = {
      keys: {
        b: { label: "乙", kind: "standard", blob: BLOB },
        a: { label: "甲", kind: "token-plan", blob: BLOB },
      },
    };
    expect(listKeySummaries(file)).toEqual([
      { id: "a", label: "甲", kind: "token-plan" },
      { id: "b", label: "乙", kind: "standard" },
    ]);
  });

  it("never exposes the encrypted blob", () => {
    const file: SecretsFile = { keys: { a: { label: "甲", kind: "standard", blob: BLOB } } };
    expect(JSON.stringify(listKeySummaries(file))).not.toContain("\"ct\"");
  });
});
