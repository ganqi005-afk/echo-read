import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SPEECH_PRESETS,
  TEXT_PRESETS,
  findPreset,
  mergeSettings,
} from "../../src/settings/types";

describe("presets", () => {
  it("keeps every speech preset on the DashScope native protocol", () => {
    for (const preset of SPEECH_PRESETS) {
      expect(preset.transport).toBe("dashscope-native");
    }
  });

  it("keeps every text preset on the OpenAI-compatible protocol", () => {
    for (const preset of TEXT_PRESETS) {
      expect(preset.transport).toBe("openai-compatible");
    }
  });

  // 已实测：Token Plan 端点无法用于语音，不应再出现在语音预设里
  it("does not offer a Token Plan endpoint as a speech preset", () => {
    for (const preset of SPEECH_PRESETS) {
      expect(preset.baseUrl).not.toContain("token-plan");
    }
  });

  it("offers Token Plan for text, where it does work", () => {
    const preset = findPreset("qianwen-token-plan");
    expect(preset?.baseUrl).toContain("token-plan");
  });

  it("returns undefined for an unknown preset instead of guessing", () => {
    expect(findPreset("nope")).toBeUndefined();
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

  it("starts with no key bound, so nothing is silently used", () => {
    expect(DEFAULT_SETTINGS.asrKeyId).toBe("");
    expect(DEFAULT_SETTINGS.ttsKeyId).toBe("");
    expect(DEFAULT_SETTINGS.llmKeyId).toBe("");
  });

  // 预设列表调整过，旧配置里的 ID 会失效，必须归一化否则下拉框空白
  it("replaces a preset id that no longer exists", () => {
    const merged = mergeSettings({
      asrPresetId: "qianwen-speech",
      ttsPresetId: "bailian-token-plan",
      llmPresetId: "gone",
    });
    expect(merged.asrPresetId).toBe(DEFAULT_SETTINGS.asrPresetId);
    expect(merged.ttsPresetId).toBe(DEFAULT_SETTINGS.ttsPresetId);
    expect(merged.llmPresetId).toBe(DEFAULT_SETTINGS.llmPresetId);
  });

  it("keeps a preset id that still exists", () => {
    expect(mergeSettings({ asrPresetId: "bailian" }).asrPresetId).toBe("bailian");
  });
});
