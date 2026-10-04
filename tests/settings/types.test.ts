import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  findPreset,
  mergeSettings,
} from "../../src/settings/types";

describe("provider presets", () => {
  it("uses the DashScope native transport for pay-as-you-go", () => {
    expect(findPreset("bailian").transport).toBe("dashscope-native");
  });

  it("uses the OpenAI-compatible transport for Token Plan", () => {
    expect(findPreset("bailian-token-plan").transport).toBe("openai-compatible");
  });

  it("points Token Plan at the subscription endpoint", () => {
    expect(findPreset("bailian-token-plan").baseUrl).toContain(
      "token-plan.cn-beijing.maas.aliyuncs.com",
    );
  });

  it("documents the sk-sp- key prefix so the field can hint it", () => {
    expect(findPreset("bailian-token-plan").keyPrefixHint).toBe("sk-sp-");
  });

  it("throws on an unknown preset rather than silently falling back", () => {
    expect(() => findPreset("nope" as never)).toThrow(/nope/);
  });
});

describe("mergeSettings", () => {
  it("returns defaults for null input", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps stored values", () => {
    expect(mergeSettings({ asrModel: "custom-model" }).asrModel).toBe("custom-model");
  });

  it("repairs a non-positive speech rate", () => {
    expect(mergeSettings({ speechRate: 0 }).speechRate).toBe(DEFAULT_SETTINGS.speechRate);
  });

  it("returns a fresh object rather than the shared default", () => {
    expect(mergeSettings({})).not.toBe(DEFAULT_SETTINGS);
  });
});
