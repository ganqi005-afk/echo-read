import { requestUrl } from "obsidian";
import {
  buildAsrBody,
  buildOpenAiCompatibleBody,
  extractTranscript,
} from "./asr-request";
import { extractModelIds } from "./models";
import { buildProbeBody, classifyKeyProbe, type KeyProbeResult } from "./key-probe";

export const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
export const DEFAULT_ASR_MODEL = "qwen-audio-3.0-asr-flash";

export type Transport = "dashscope-native" | "openai-compatible";

export interface AsrClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  transport: Transport;
}

export const DASHSCOPE_NATIVE_PATH =
  "/api/v1/services/aigc/multimodal-generation/generation";
export const OPENAI_COMPATIBLE_PATH = "/chat/completions";

export function buildEndpoint(baseUrl: string, transport: Transport): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = transport === "openai-compatible" ? OPENAI_COMPATIBLE_PATH : DASHSCOPE_NATIVE_PATH;
  return `${base}${path}`;
}

/**
 * 生成可展示的请求体预览：结构完全真实，只把音频数据替换成占位符，
 * 既方便核对字段名，又不会把几百 KB 的 base64 刷满屏幕。
 * 预览里不含任何凭据（Key 走请求头）。
 */
export function previewRequestBody(
  options: Pick<AsrClientOptions, "transport" | "model">,
  audioDataUri: string,
): string {
  const body =
    options.transport === "openai-compatible"
      ? buildOpenAiCompatibleBody({
          model: options.model,
          audioDataUri,
          sampleRate: 16000,
        })
      : buildAsrBody({ model: options.model, audioDataUri, sampleRate: 16000 });

  return JSON.stringify(body, null, 2).replaceAll(
    audioDataUri,
    `«base64 音频，${audioDataUri.length} 字符»`,
  );
}

/**
 * 列出该渠道可用的模型。用于确认某个模型 ID 在本渠道是否真的存在 ——
 * 这比对着文档猜模型名可靠得多。
 */
export async function listModels(options: {
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  if (!options.apiKey) throw new Error("尚未配置 API Key。");

  const url = `${options.baseUrl.replace(/\/+$/, "")}/models`;
  const response = await requestUrl({
    url,
    method: "GET",
    headers: { Authorization: `Bearer ${options.apiKey}` },
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    const body = response.text ?? "";
    console.error("[Echo Read] 获取模型列表失败", {
      status: response.status,
      url,
      body,
    });
    throw new Error(`获取模型列表失败（HTTP ${response.status}）：${truncate(body, 400)}`);
  }

  return extractModelIds(response.json);
}

/**
 * 只验证 Key 是否可用，不发送音频。
 * 用参数不完整的请求做探针：Key 无效会在鉴权阶段被拦（401/403），
 * Key 有效则会走到参数校验并报参数错误。
 */
export async function probeApiKey(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  transport: Transport;
}): Promise<KeyProbeResult> {
  if (!options.apiKey) throw new Error("尚未配置 API Key。");

  const url = buildEndpoint(options.baseUrl, options.transport);
  const response = await requestUrl({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "disable",
    },
    body: JSON.stringify(buildProbeBody(options.model, options.transport)),
    throw: false,
  });

  const body = response.text ?? "";
  return {
    outcome: classifyKeyProbe(response.status, safeJson(response.text)),
    status: response.status,
    detail: body.slice(0, 400),
  };
}

function safeJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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

  const url = buildEndpoint(options.baseUrl, options.transport);
  const requestBody =
    options.transport === "openai-compatible"
      ? buildOpenAiCompatibleBody({
          model: options.model,
          audioDataUri,
          sampleRate: 16000,
        })
      : buildAsrBody({ model: options.model, audioDataUri, sampleRate: 16000 });

  const response = await requestUrl({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "disable",
    },
    body: JSON.stringify(requestBody),
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    const body = response.text ?? "";
    // 完整响应只进控制台便于排查；URL 不含凭据（Key 走 Authorization 头）
    console.error("[Echo Read] 语音识别请求失败", {
      status: response.status,
      url,
      body,
    });
    throw new Error(
      `语音识别请求失败（HTTP ${response.status}）：${truncate(body, 600)}`,
    );
  }

  return extractTranscript(response.json);
}

function truncate(text: string, limit = 600): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
