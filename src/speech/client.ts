import { requestUrl } from "obsidian";
import { buildAsrBody, extractTranscript } from "./asr-request";

export const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
export const DEFAULT_ASR_MODEL = "qwen-audio-3.0-asr-flash";

export interface AsrClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 安全约束（设计文档 15.3 的硬性编码规则）：
 * - 绝不把 apiKey 写进 URL query
 * - 绝不把 apiKey 或完整请求体写进日志与错误信息
 */
export async function transcribeAudio(
  options: AsrClientOptions,
  audioDataUri: string,
): Promise<string> {
  if (!options.apiKey) {
    throw new Error("尚未配置 API Key，请先在插件设置中填写。");
  }

  const url = `${options.baseUrl.replace(/\/+$/, "")}/api/v1/services/aigc/multimodal-generation/generation`;

  const response = await requestUrl({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "disable",
    },
    body: JSON.stringify(
      buildAsrBody({ model: options.model, audioDataUri, sampleRate: 16000 }),
    ),
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `语音识别请求失败（HTTP ${response.status}）：${truncate(response.text)}`,
    );
  }

  return extractTranscript(response.json);
}

function truncate(text: string, limit = 300): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
