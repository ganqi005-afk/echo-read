export interface TtsRequestOptions {
  model: string;
  text: string;
  voice: string;
  format?: string;
  sampleRate?: number;
}

/**
 * Qwen-Audio-TTS 的 HTTP 请求体。
 * 依据官方文档「非实时语音合成Qwen-Audio-TTS HTTP API参考」：
 * POST /api/v1/services/audio/tts/SpeechSynthesizer
 * 注意 voice 是必选，且没有默认值 —— 必须由用户在设置里选一个音色。
 */
export function buildTtsBody(options: TtsRequestOptions): unknown {
  return {
    model: options.model,
    input: {
      text: options.text,
      voice: options.voice,
      format: options.format ?? "mp3",
      sample_rate: options.sampleRate ?? 24000,
    },
  };
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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return "[无法序列化的响应]";
  }
}
