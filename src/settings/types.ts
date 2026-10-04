import { DEFAULT_ASR_MODEL, DEFAULT_BASE_URL, type Transport } from "../speech/client";

export type TtsMode = "system" | "cloud";

export interface Preset {
  id: string;
  name: string;
  transport: Transport;
  baseUrl: string;
  note: string;
}

/**
 * 语音通道的预设。这一组只走 DashScope 原生协议。
 *
 * 这里刻意**只保留能用的**：早先列过「Token Plan」和「OpenAI 兼容」等预设，
 * 但实测证明它们无法用于语音（见设计文档 7.3.1），留着只会误导，
 * 因此删除；将来若官方提供浏览器可用的鉴权方式再加回来。
 */
export const SPEECH_PRESETS: readonly Preset[] = [
  {
    id: "qianwen",
    name: "千问AI平台",
    transport: "dashscope-native",
    baseUrl: DEFAULT_BASE_URL,
    note: "已验证可用。识别与合成共用这个地址，但可以绑定不同的 Key。",
  },
  {
    id: "bailian",
    name: "阿里云百炼（直连）",
    transport: "dashscope-native",
    baseUrl: "https://dashscope.aliyuncs.com",
    note: "同协议的另一家平台，换账号时用。",
  },
  {
    id: "custom-speech",
    name: "自定义",
    transport: "dashscope-native",
    baseUrl: "",
    note: "手填 DashScope 原生协议的接入地址。",
  },
];

/**
 * 文本能力的预设。这一组走 OpenAI 兼容协议 —— 普通 HTTP 请求，
 * Obsidian 可以正常携带鉴权头，因此 Token Plan 的文本模型在这里是**可用的**。
 */
export const TEXT_PRESETS: readonly Preset[] = [
  {
    id: "qianwen-token-plan",
    name: "千问AI平台 · Token Plan",
    transport: "openai-compatible",
    baseUrl: "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
    note: "用 sk-sp- 开头的 Token Plan Key。语音能力在此端点上不可用，仅用于文本。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    transport: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    note: "用 DeepSeek 的普通 Key。",
  },
  {
    id: "custom-text",
    name: "自定义（OpenAI 兼容）",
    transport: "openai-compatible",
    baseUrl: "",
    note: "任何 OpenAI 兼容端点。",
  },
];

export function findPreset(id: string): Preset | undefined {
  return [...SPEECH_PRESETS, ...TEXT_PRESETS].find((preset) => preset.id === id);
}

export const DEFAULT_TTS_BASE_URL = DEFAULT_BASE_URL;
export const DEFAULT_CLOUD_TTS_MODEL = "qwen-audio-3.0-tts-flash";
export const DEFAULT_CLOUD_TTS_VOICE = "longanhuan_v3.6";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

export interface EchoReadSettings {
  /** 语音识别：绑定哪把 Key，走哪个端点与模型。 */
  asrPresetId: string;
  asrKeyId: string;
  asrTransport: Transport;
  asrBaseUrl: string;
  asrModel: string;

  /** 语音合成：系统语音免费，云端按字符计费。 */
  ttsMode: TtsMode;
  ttsPresetId: string;
  ttsKeyId: string;
  ttsBaseUrl: string;
  ttsModel: string;
  ttsVoice: string;

  /** 文本能力（弱项解释、卡片选词）：走 OpenAI 兼容协议。 */
  llmPresetId: string;
  llmKeyId: string;
  llmTransport: Transport;
  llmBaseUrl: string;
  llmModel: string;

  /** 朗读。 */
  voiceURI: string;
  speechRate: number;
}

export const DEFAULT_SETTINGS: EchoReadSettings = {
  asrPresetId: "qianwen",
  asrKeyId: "",
  asrTransport: "dashscope-native",
  asrBaseUrl: DEFAULT_BASE_URL,
  asrModel: DEFAULT_ASR_MODEL,

  ttsMode: "system",
  ttsPresetId: "qianwen",
  ttsKeyId: "",
  ttsBaseUrl: DEFAULT_TTS_BASE_URL,
  ttsModel: DEFAULT_CLOUD_TTS_MODEL,
  ttsVoice: DEFAULT_CLOUD_TTS_VOICE,

  llmPresetId: "qianwen-token-plan",
  llmKeyId: "",
  llmTransport: "openai-compatible",
  llmBaseUrl: TEXT_PRESETS[0].baseUrl,
  llmModel: "qwen3.8-flash",

  voiceURI: "",
  speechRate: 1,
};

export function mergeSettings(
  stored: Partial<EchoReadSettings> | null | undefined,
): EchoReadSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  if (merged.speechRate <= 0) merged.speechRate = DEFAULT_SETTINGS.speechRate;

  // 预设列表发生过调整（删掉了误导性的项），旧配置里的 ID 可能已不存在。
  // 不归一化的话，设置页的下拉框会显示空白，看起来像"配置丢了"。
  if (!findPreset(merged.asrPresetId)) merged.asrPresetId = DEFAULT_SETTINGS.asrPresetId;
  if (!findPreset(merged.ttsPresetId)) merged.ttsPresetId = DEFAULT_SETTINGS.ttsPresetId;
  if (!findPreset(merged.llmPresetId)) merged.llmPresetId = DEFAULT_SETTINGS.llmPresetId;

  return merged;
}
