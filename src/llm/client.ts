import { App, requestUrl } from "obsidian";
import { buildEndpoint, type Transport } from "../speech/client";
import {
  DEFAULT_PRACTICE_PROMPT,
  parseFeedback,
  renderPrompt,
  type PracticeContext,
  type PracticeFeedback,
} from "./prompt";

export const PROMPT_DIR = "_lingo/prompts";
export const PRACTICE_PROMPT_PATH = "_lingo/prompts/practice-review.md";

export interface LlmClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  transport: Transport;
}

/**
 * 调用文本模型（OpenAI 兼容的 /chat/completions）。
 *
 * 与语音接口不同，这是一条**普通 HTTP 请求** —— 所以 Token Plan 的
 * sk-sp- Key 在这里是可用的（设计文档 7.3.1）。
 */
export async function chatCompletion(
  options: LlmClientOptions,
  systemPrompt: string,
  userContent: string,
  maxTokens = 512,
): Promise<string> {
  if (!options.apiKey) throw new Error("尚未配置文本模型的 API Key。");

  const url = buildEndpoint(options.baseUrl, options.transport);
  const response = await requestUrl({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    const body = response.text ?? "";
    console.error("[Echo Read] 文本模型请求失败", { status: response.status, url, body });
    throw new Error(`文本模型请求失败（HTTP ${response.status}）：${truncate(body, 600)}`);
  }

  return extractMessage(response.json);
}

/** 从 OpenAI 兼容响应里取出正文。 */
export function extractMessage(payload: unknown): string {
  const choices = (payload as { choices?: unknown })?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
    if (typeof content === "string" && content.trim() !== "") return content;
  }
  throw new Error(`无法从响应中提取文本：${truncate(safeStringify(payload), 400)}`);
}

/**
 * 读取练习用的提示词：优先 vault 里的文件，其次内置默认值。
 *
 * 文件化是刻意的（设计文档 13.4）：提示词对用户透明、能随手改、
 * 随 vault 同步到 iPad，改坏了删掉文件即回退默认。
 */
export async function loadPracticePrompt(app: App): Promise<string> {
  const adapter = app.vault.adapter;
  try {
    if (await adapter.exists(PRACTICE_PROMPT_PATH)) {
      const content = await adapter.read(PRACTICE_PROMPT_PATH);
      if (content.trim() !== "") return content;
    }
  } catch {
    // 读不到就用默认值，不让提示词问题阻断功能
  }
  return DEFAULT_PRACTICE_PROMPT;
}

/** 首次使用时把默认提示词写出来，方便直接编辑。 */
export async function ensurePracticePromptFile(app: App): Promise<void> {
  const adapter = app.vault.adapter;
  try {
    if (await adapter.exists(PRACTICE_PROMPT_PATH)) return;
    if (!(await adapter.exists(PROMPT_DIR))) await adapter.mkdir(PROMPT_DIR);
    await adapter.write(PRACTICE_PROMPT_PATH, DEFAULT_PRACTICE_PROMPT);
  } catch {
    // 写不进去也不影响功能，只是提示词没法在 vault 里编辑
  }
}

/** 用一次练习的结果向模型索要讲解与卡片建议。 */
export async function requestPracticeFeedback(
  app: App,
  options: LlmClientOptions,
  context: PracticeContext,
): Promise<PracticeFeedback> {
  const template = await loadPracticePrompt(app);
  const prompt = renderPrompt(template, context);

  // 模板已包含全部上下文，用户消息只作引导，避免重复喂一遍
  const raw = await chatCompletion(options, prompt, "请按要求输出 JSON。");
  return parseFeedback(raw);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[无法序列化的响应]";
  }
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
