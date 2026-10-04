import { requestUrl } from "obsidian";
import {
  buildTtsBody,
  extractAudioUrl,
  ttsEndpointPath,
  type TtsVoice,
} from "./tts-request";

export const DEFAULT_TTS_BASE_URL = "https://maas.qianwenaiapi.com";

/**
 * 端点由模型系列决定，**不从设置里手填** ——
 * 官方明确要求"端点不可混用"，用错只会拿到一个没有说明的 400。
 */
export function resolveTtsEndpoint(baseUrl: string, model: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${ttsEndpointPath(model)}`;
}

export interface TtsClientOptions {
  baseUrl: string;
  apiKey: string;
  voice: TtsVoice;
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
    case "opus":
      return "audio/opus";
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
  if (!options.voice.voice) throw new Error("尚未配置音色 —— 合成接口的 voice 是必填项。");

  const url = resolveTtsEndpoint(options.baseUrl, options.voice.model);

  const response = await requestUrl({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTtsBody(options.voice, text)),
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    const body = response.text ?? "";
    console.error("[Echo Read] 语音合成请求失败", { status: response.status, url, body });
    throw new Error(`语音合成失败（HTTP ${response.status}）：${truncate(body, 600)}`);
  }

  const audio = extractAudioUrl(response.json);

  const download = await requestUrl({ url: audio.url, method: "GET", throw: false });
  if (download.status < 200 || download.status >= 300) {
    throw new Error(`下载合成音频失败（HTTP ${download.status}）。链接可能已过期。`);
  }

  return {
    bytes: download.arrayBuffer,
    mimeType: guessMimeType(options.voice.format),
    expiresAt: audio.expiresAt,
  };
}

/**
 * 可展示的请求体预览。注意 HTTP 接口与 WebSocket 接口的组织方式不同：
 * WebSocket 用单独的 continue-task 消息发文本，而 HTTP 把文本直接放在
 * input.text 里，与参数同在一个请求体。预览让这一点可见、可核对。
 */
export function previewTtsBody(voice: TtsVoice, text: string): string {
  return JSON.stringify(buildTtsBody(voice, text), null, 2);
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
