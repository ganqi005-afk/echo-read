import { DEFAULT_ASR_MODEL, DEFAULT_BASE_URL, type Transport } from "../speech/client";

export type ProviderPresetId = "bailian" | "bailian-token-plan" | "custom";

export interface ProviderPreset {
  id: ProviderPresetId;
  name: string;
  transport: Transport;
  baseUrl: string;
  keyPrefixHint: string;
  note: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "bailian",
    name: "阿里云百炼 · 按量计费",
    transport: "dashscope-native",
    baseUrl: DEFAULT_BASE_URL,
    keyPrefixHint: "sk-",
    note: "识别 0.00022 元/秒，合成 0.8 元/万字符。免费额度：识别 36,000 秒 / 合成 1 万字符。",
  },
  {
    id: "bailian-token-plan",
    name: "阿里云百炼 · Token Plan（订阅制）",
    transport: "openai-compatible",
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    keyPrefixHint: "sk-sp-",
    note: "按 Credits 抵扣。该渠道是否覆盖语音识别与合成模型尚未验证，请用「测试连接」确认。",
  },
  {
    id: "custom",
    name: "自定义（千问AI平台等兼容渠道）",
    transport: "openai-compatible",
    baseUrl: "",
    keyPrefixHint: "任意",
    note: "填入任意 OpenAI 兼容端点的 Base URL。",
  },
];

export const DEFAULT_TTS_MODEL_ID = "qwen3-tts-flash";

export interface EchoReadSettings {
  presetId: ProviderPresetId;
  transport: Transport;
  baseUrl: string;
  asrModel: string;
  ttsModel: string;
  voiceURI: string;
  speechRate: number;
}

export const DEFAULT_SETTINGS: EchoReadSettings = {
  presetId: "bailian",
  transport: "dashscope-native",
  baseUrl: DEFAULT_BASE_URL,
  asrModel: DEFAULT_ASR_MODEL,
  ttsModel: DEFAULT_TTS_MODEL_ID,
  voiceURI: "",
  speechRate: 1,
};

export function findPreset(id: ProviderPresetId): ProviderPreset {
  const found = PROVIDER_PRESETS.find((preset) => preset.id === id);
  if (!found) throw new Error(`未知的渠道预设：${id}`);
  return found;
}

export function mergeSettings(
  stored: Partial<EchoReadSettings> | null | undefined,
): EchoReadSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  if (merged.speechRate <= 0) merged.speechRate = DEFAULT_SETTINGS.speechRate;
  return merged;
}

export const SECRET_KEY_NAME = "bailianApiKey";
