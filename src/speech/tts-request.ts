/**
 * 一次合成所需的全部音色参数。
 *
 * 注意：不同模型系列能接受的参数**并不相同**。这里的字段是各系列的并集，
 * 真正发送时由 buildTtsBody 按系列筛选 —— 多传未知字段会让服务端直接拒绝。
 */
export interface TtsVoice {
  model: string;
  voice: string;
  format: string;
  sampleRate: number;
  rate: number;
  volume: number;
  pitch: number;
  /** 指令控制。Qwen-Audio-TTS 用 instruction，Qwen-TTS 用 instructions —— 由系列决定。 */
  instruction: string;
  /** 语种提示。Qwen-Audio-TTS 用 language，Qwen-TTS 用 language_type。 */
  language: string;
}

export const DEFAULT_RATE = 1;
export const DEFAULT_VOLUME = 50;
export const DEFAULT_PITCH = 1;

export const DEFAULT_TTS_VOICE: TtsVoice = {
  model: "qwen-audio-3.0-tts-flash",
  voice: "longanhuan_v3.6",
  format: "mp3",
  sampleRate: 24000,
  rate: DEFAULT_RATE,
  volume: DEFAULT_VOLUME,
  pitch: DEFAULT_PITCH,
  instruction: "",
  language: "",
};

// ---------------- 模型系列 ----------------

export type TtsFamily = "qwen-audio" | "cosyvoice" | "qwen-tts" | "minimax";

export interface TtsFamilySpec {
  id: TtsFamily;
  name: string;
  /** 拼在 Base URL 之后的路径。官方明确要求"端点不可混用"。 */
  path: string;
  voiceExample: string;
  note: string;
}

const FAMILIES: Record<TtsFamily, TtsFamilySpec> = {
  "qwen-audio": {
    id: "qwen-audio",
    name: "Qwen-Audio-TTS",
    path: "/api/v1/services/audio/tts/SpeechSynthesizer",
    voiceExample: "longanhuan_v3.6",
    note: "支持语速、音量、音调、音频格式、采样率与指令控制。非实时仅北京地域可用。",
  },
  cosyvoice: {
    id: "cosyvoice",
    name: "CosyVoice",
    path: "/api/v1/services/audio/tts/SpeechSynthesizer",
    voiceExample: "longanyang",
    note: "参数集与 Qwen-Audio-TTS 相同，指令参数名为 instruction。",
  },
  "qwen-tts": {
    id: "qwen-tts",
    name: "Qwen-TTS",
    path: "/api/v1/services/aigc/multimodal-generation/generation",
    voiceExample: "Cherry",
    note:
      "端点与 Qwen-Audio-TTS 不同。参数集也不同：用 language_type 与 instructions（复数），" +
      "不传 format / sample_rate / rate / volume / pitch。",
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    path: "/api/v1/services/aigc/multimodal-generation/generation",
    voiceExample: "male-qn-qingse",
    note:
      "参数结构完全不同：用 voice_setting 与 audio_setting。音色 ID 形如 male-qn-qingse。" +
      "支持 emotion 情感控制。",
  },
};

/**
 * 按模型 ID 判断属于哪个系列。
 *
 * 这一步很关键：官方写明"端点不可混用"，用错端点只会拿到一个没有说明的 400。
 * 与其让用户手填端点，不如由模型名推出来。
 */
export function detectTtsFamily(model: string): TtsFamily {
  const id = model.trim();
  if (/^minimax\//i.test(id)) return "minimax";
  if (/^cosyvoice/i.test(id)) return "cosyvoice";
  if (/^qwen3-tts|^qwen-tts/i.test(id)) return "qwen-tts";
  return "qwen-audio";
}

export function ttsFamilySpec(family: TtsFamily): TtsFamilySpec {
  return FAMILIES[family];
}

export function ttsEndpointPath(model: string): string {
  return ttsFamilySpec(detectTtsFamily(model)).path;
}

// ---------------- 请求体 ----------------

/**
 * 按系列构造 HTTP 请求体。
 *
 * 只发送**该系列文档明确列出**的字段。多传未知字段会被服务端拒绝，
 * 而各系列的参数名又互不相同（instruction / instructions、language / language_type），
 * 所以这里必须逐系列分支，不能"一套参数打天下"。
 */
export function buildTtsBody(voice: TtsVoice, text: string): unknown {
  switch (detectTtsFamily(voice.model)) {
    case "minimax":
      return buildMiniMaxBody(voice, text);
    case "qwen-tts":
      return buildQwenTtsBody(voice, text);
    default:
      return buildSpeechSynthesizerBody(voice, text);
  }
}

/** Qwen-Audio-TTS 与 CosyVoice 共用这个结构。 */
function buildSpeechSynthesizerBody(voice: TtsVoice, text: string): unknown {
  const input: Record<string, unknown> = {
    text,
    voice: voice.voice,
    format: voice.format,
    sample_rate: voice.sampleRate,
    rate: voice.rate,
    volume: voice.volume,
    pitch: voice.pitch,
  };

  if (voice.instruction.trim() !== "") input.instruction = voice.instruction.trim();
  if (voice.language.trim() !== "") input.language = voice.language.trim();

  return { model: voice.model, input };
}

/** Qwen-TTS 只接受它自己那一套字段，多传会报错。 */
function buildQwenTtsBody(voice: TtsVoice, text: string): unknown {
  const input: Record<string, unknown> = { text, voice: voice.voice };
  if (voice.language.trim() !== "") input.language_type = voice.language.trim();
  if (voice.instruction.trim() !== "") input.instructions = voice.instruction.trim();
  return { model: voice.model, input };
}

/**
 * MiniMax 用嵌套的 voice_setting / audio_setting。
 *
 * 只映射语义明确的字段：音量与音调在 MiniMax 里是不同的量纲
 * （vol 0–10、pitch 以半音计），未经实测不做换算，宁可不传。
 */
function buildMiniMaxBody(voice: TtsVoice, text: string): unknown {
  return {
    model: voice.model,
    input: {
      text,
      voice_setting: {
        voice_id: voice.voice,
        speed: voice.rate,
      },
      audio_setting: {
        sample_rate: voice.sampleRate,
        format: voice.format,
        channel: 1,
      },
    },
  };
}

export interface SynthesizedAudio {
  url: string;
  expiresAt?: number;
}

/**
 * 从非流式响应里取出音频地址。
 * 返回的是**会过期的 OSS 链接**（文档：有效期 24 小时），所以调用方必须立刻
 * 下载落盘，不能把 URL 当缓存存起来（设计文档 12.1）。
 */
export function extractAudioUrl(payload: unknown): SynthesizedAudio {
  if (!payload || typeof payload !== "object") {
    throw new Error(`无法解析语音合成响应：${safeStringify(payload)}`);
  }
  const audio = (payload as { output?: { audio?: unknown } }).output?.audio;
  if (!audio || typeof audio !== "object") {
    throw new Error(`语音合成响应里没有 audio 字段：${safeStringify(payload)}`);
  }
  const node = audio as { url?: unknown; expires_at?: unknown };
  if (typeof node.url !== "string" || node.url === "") {
    throw new Error(`语音合成响应里没有可用的音频地址：${safeStringify(payload)}`);
  }
  return {
    url: node.url,
    expiresAt: typeof node.expires_at === "number" ? node.expires_at : undefined,
  };
}

/**
 * 缓存键只纳入**偏离默认值**的参数。
 *
 * 这样有两个好处：
 * 1. 调了语速就必须重新合成 —— 否则会放旧语速的缓存，钱花了却听不到变化；
 * 2. 参数都是默认值时，键与旧版本完全一致 —— **已有缓存不会失效**，
 *    不必为一次重构重新付费。
 */
export function voiceSignature(voice: TtsVoice): string {
  const parts = [voice.model, voice.voice, voice.format];

  if (voice.sampleRate !== DEFAULT_TTS_VOICE.sampleRate) {
    parts.push(`sr=${voice.sampleRate}`);
  }
  if (voice.rate !== DEFAULT_RATE) parts.push(`rate=${voice.rate}`);
  if (voice.volume !== DEFAULT_VOLUME) parts.push(`vol=${voice.volume}`);
  if (voice.pitch !== DEFAULT_PITCH) parts.push(`pitch=${voice.pitch}`);
  if (voice.instruction.trim() !== "") parts.push(`instr=${voice.instruction.trim()}`);
  if (voice.language.trim() !== "") parts.push(`lang=${voice.language.trim()}`);

  // 分隔符必须与旧版缓存键一致（\u0000），否则已有缓存会全部失配 ——
  // 那等于把用户已经付过费的合成结果全部作废，是真实的金钱损失。
  return parts.join("\u0000");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return "[无法序列化的响应]";
  }
}
