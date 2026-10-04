import { describe, expect, it } from "vitest";
import {
  classifyApiKey,
  describeKeyEndpointMismatch,
} from "../../src/settings/key-format";

const TOKEN_PLAN_URL = "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1";
const NATIVE_URL = "https://maas.qianwenaiapi.com";

describe("classifyApiKey", () => {
  it("recognises a Token Plan key", () => {
    expect(classifyApiKey("sk-sp-abcdef")).toBe("token-plan");
  });

  it("recognises a standard key", () => {
    expect(classifyApiKey("sk-abcdef")).toBe("standard");
  });

  it("flags anything else as unknown", () => {
    expect(classifyApiKey("abc123")).toBe("unknown");
  });

  it("ignores surrounding whitespace", () => {
    expect(classifyApiKey("  sk-sp-abcdef  ")).toBe("token-plan");
  });
});

describe("describeKeyEndpointMismatch", () => {
  it("warns when a Token Plan key is used on a plain endpoint", () => {
    const warning = describeKeyEndpointMismatch("sk-sp-abcdef", NATIVE_URL);
    expect(warning).toContain("Token Plan");
  });

  it("warns when a plain key is used on a Token Plan endpoint", () => {
    const warning = describeKeyEndpointMismatch("sk-abcdef", TOKEN_PLAN_URL);
    expect(warning).toContain("sk-sp-");
  });

  it("stays quiet when key and endpoint agree", () => {
    expect(describeKeyEndpointMismatch("sk-sp-abcdef", TOKEN_PLAN_URL)).toBeUndefined();
    expect(describeKeyEndpointMismatch("sk-abcdef", NATIVE_URL)).toBeUndefined();
  });

  it("never echoes the key itself", () => {
    const warning = describeKeyEndpointMismatch("sk-sp-SECRETVALUE", NATIVE_URL) ?? "";
    expect(warning).not.toContain("SECRETVALUE");
  });
});
