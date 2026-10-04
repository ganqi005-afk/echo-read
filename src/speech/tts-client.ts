import { requestUrl } from "obsidian";
import { buildTtsBody, extractAudioUrl } from "./tts-request";

export const DEFAULT_TTS_BASE_URL = "https://maas.qianwenaiapi.com";
export const TTS_HTTP_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
export const DEFAULT_TTS_MODEL = "qwen-audio-3.0-tts-flash";
export const DEFAULT_TTS_VOICE = "longanhuan_v3.6";

export interface TtsClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  format?: string;
  sampleRate?: number;
}

export interface SynthesizedAudio {
  bytes: ArrayBuffer;
  mimeType: string;
  expiresAt?: number;
}

export function guessMimeType(format: string): string {
  switch (format.toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/L16";
    default:
      return "application/octet-stream";
  }
}

/**
 * 云端语音合成（HTTP，非流式）。
 *
 * 关键点：返回的是**会过期的 OSS 链接**（带 expires_at），所以这里立刻下载
 * 并返回字节，绝不让 URL 外流 —— 调用方负责把字节写进缓存（设计文档 12.1）。
 */
export async function synthesizeSpeech(
  options: TtsClientOptions,
  text: string,
): Promise<SynthesizedAudio> {
  if (!options.apiKey) throw new Error("尚未配置 API Key。");
  if (!options.voice) throw new Error("尚未配置音色 —— 合成接口的 voice 是必填项。");

  const format = options.format ?? "mp3";
  const url = `${options.baseUrl.replace(/\/+$/, "")}${TTS_HTTP_PATH}`;

  const response = await requestUrl({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildTtsBody({
        model: options.model,
        text,
        voice: options.voice,
        format,
        sampleRate: options.sampleRate ?? 24000,
      }),
    ),
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    const body = response.text ?? "";
    console.error("[Echo Read] 语音合成请求失败", {
      status: response.status,
      url,
      body,
    });
    throw new Error(`语音合成失败（HTTP ${response.status}）：${truncate(body, 600)}`);
  }

  const audio = extractAudioUrl(response.json);

  const download = await requestUrl({ url: audio.url, method: "GET", throw: false });
  if (download.status < 200 || download.status >= 300) {
    throw new Error(`下载合成音频失败（HTTP ${download.status}）。链接可能已过期。`);
  }

  return {
    bytes: download.arrayBuffer,
    mimeType: guessMimeType(format),
    expiresAt: audio.expiresAt,
  };
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
