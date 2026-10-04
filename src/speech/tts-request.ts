/**
 * 一次合成所需的全部音色参数。
 *
 * 依据官方「非实时语音合成 Qwen-Audio-TTS HTTP API 参考」的参数表：
 * voice 必填；rate / volume / pitch / instruction / language / format / sample_rate 可选。
 */
export interface TtsVoice {
  model: string;
  voice: string;
  format: string;
  sampleRate: number;
  /** 语速，默认 1.0，范围 [0.5, 2.0]。 */
  rate: number;
  /** 音量，默认 50，范围 [0, 100]。 */
  volume: number;
  /** 音调，默认 1.0，范围 [0.5, 2.0]。 */
  pitch: number;
  /** 指令控制：用自然语言描述方言、情感或角色。留空则不传。 */
  instruction: string;
  /** 语种提示，如 en / zh / ja。留空则不传。 */
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

/**
 * 构造 HTTP 请求体。
 *
 * 数值参数一律显式传入，避免服务端默认值变更时行为漂移；
 * 空字符串的 instruction / language 则**不传**，否则等于让服务端处理一个空指令。
 */
export function buildTtsBody(voice: TtsVoice, text: string): unknown {
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

export interface SynthesizedAudio {
  url: string;
  expiresAt?: number;
}

/**
 * 从非流式响应里取出音频地址。
 * 返回的是**会过期的 OSS 链接**，所以调用方必须立刻下载落盘，
 * 不能把 URL 当缓存存起来（设计文档 12.1）。
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
