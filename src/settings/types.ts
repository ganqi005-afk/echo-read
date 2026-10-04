import { DEFAULT_ASR_MODEL, DEFAULT_BASE_URL, type Transport } from "../speech/client";

export type ProviderPresetId =
  | "bailian"
  | "bailian-token-plan"
  | "qianwen-speech"
  | "qianwen-token-plan"
  | "custom";

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
    id: "qianwen-speech",
    name: "千问AI平台 · 语音接口（DashScope 原生）",
    transport: "dashscope-native",
    baseUrl: "https://maas.qianwenaiapi.com",
    keyPrefixHint: "sk-",
    note: "qwen-audio-3.x-asr-flash 在这家平台上走 DashScope 原生协议。语音模型请用这一项，不要用 Token Plan 端点。",
  },
  {
    id: "qianwen-token-plan",
    name: "千问AI平台 · Token Plan（OpenAI 兼容）",
    transport: "openai-compatible",
    baseUrl: "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
    keyPrefixHint: "sk-",
    note: "这是 Token Plan 的聊天端点。用它调语音模型会返回空的 400，语音请改用上一项。",
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

export interface EchoReadSettings {
  presetId: ProviderPresetId;
  transport: Transport;
  baseUrl: string;
  asrModel: string;
  ttsMode: TtsMode;
  ttsBaseUrl: string;
  ttsModel: string;
  ttsVoice: string;
  voiceURI: string;
  speechRate: number;
}

/** 系统语音免费且离线；云端合成音色更好但按字符计费。 */
export type TtsMode = "system" | "cloud";

export const DEFAULT_TTS_BASE_URL = "https://maas.qianwenaiapi.com";
export const DEFAULT_CLOUD_TTS_MODEL = "qwen-audio-3.0-tts-flash";
export const DEFAULT_CLOUD_TTS_VOICE = "longanhuan_v3.6";

export const DEFAULT_SETTINGS: EchoReadSettings = {
  presetId: "bailian",
  transport: "dashscope-native",
  baseUrl: DEFAULT_BASE_URL,
  asrModel: DEFAULT_ASR_MODEL,
  ttsMode: "system",
  ttsBaseUrl: DEFAULT_TTS_BASE_URL,
  ttsModel: DEFAULT_CLOUD_TTS_MODEL,
  ttsVoice: DEFAULT_CLOUD_TTS_VOICE,
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
