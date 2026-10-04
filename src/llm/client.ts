import { App, requestUrl } from "obsidian";
import { buildEndpoint, type Transport } from "../speech/client";
import {
  DEFAULT_ASK_PROMPT,
  DEFAULT_ETYMOLOGY_PROMPT,
  DEFAULT_PRACTICE_PROMPT,
  formatSynonymHint,
  parseFeedback,
  pickSynonymCycle,
  renderAskPrompt,
  renderEtymologyPrompt,
  renderPrompt,
  type AskContext,
  type PracticeContext,
  type PracticeFeedback,
} from "./prompt";

export const PROMPT_DIR = "_lingo/prompts";
export const PRACTICE_PROMPT_PATH = "_lingo/prompts/practice-review.md";
export const ASK_PROMPT_PATH = "_lingo/prompts/ask-selection.md";
export const ETYMOLOGY_PROMPT_PATH = "_lingo/prompts/etymology.md";

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
  return loadPrompt(app, PRACTICE_PROMPT_PATH, DEFAULT_PRACTICE_PROMPT);
}

export async function loadAskPrompt(app: App): Promise<string> {
  return loadPrompt(app, ASK_PROMPT_PATH, DEFAULT_ASK_PROMPT);
}

/** 读 vault 里的提示词文件；没有或读不到就用内置默认值。 */
async function loadPrompt(app: App, path: string, fallback: string): Promise<string> {
  const adapter = app.vault.adapter;
  try {
    if (await adapter.exists(path)) {
      const content = await adapter.read(path);
      if (content.trim() !== "") return content;
    }
  } catch {
    // 读不到就用默认值，不让提示词问题阻断功能
  }
  return fallback;
}

/** 首次使用时把默认提示词写出来，方便直接编辑。 */
export async function ensurePracticePromptFile(app: App): Promise<void> {
  await ensurePromptFile(app, PRACTICE_PROMPT_PATH, DEFAULT_PRACTICE_PROMPT);
  await ensurePromptFile(app, ASK_PROMPT_PATH, DEFAULT_ASK_PROMPT);
  await ensurePromptFile(app, ETYMOLOGY_PROMPT_PATH, DEFAULT_ETYMOLOGY_PROMPT);
}

async function ensurePromptFile(app: App, path: string, content: string): Promise<void> {
  const adapter = app.vault.adapter;
  try {
    if (await adapter.exists(path)) return;
    if (!(await adapter.exists(PROMPT_DIR))) await adapter.mkdir(PROMPT_DIR);
    await adapter.write(path, content);
  } catch {
    // 写不进去也不影响功能，只是提示词没法在 vault 里编辑
  }
}

/**
 * 就选中的文本向模型提问。
 *
 * 与 requestPracticeFeedback 的区别在于**谁发起的**：
 * 那是系统自动生成的反馈，这是用户主动问的，所以提示词也不同。
 */
export async function askAboutSelection(
  app: App,
  options: LlmClientOptions,
  context: AskContext,
): Promise<string> {
  const template = await loadAskPrompt(app);
  const prompt = renderAskPrompt(template, context);
  return chatCompletion(options, prompt, "请回答。", 800);
}

/**
 * 词源解析。
 *
 * `turn` 是本次是第几次解析，用来推进同义词轮换 ——
 * 那份提示词要求"接下来 3–5 条继续使用同一个同义词"，
 * 而无状态的 API 调用必须由本地记这个数。
 */
export async function analyzeEtymology(
  app: App,
  options: LlmClientOptions,
  text: string,
  turn: number,
): Promise<string> {
  const template = await loadPrompt(app, ETYMOLOGY_PROMPT_PATH, DEFAULT_ETYMOLOGY_PROMPT);
  const prompt = renderEtymologyPrompt(template, {
    text,
    synonyms: formatSynonymHint(pickSynonymCycle(turn)),
  });
  return chatCompletion(options, prompt, "请按格式解析。", 1200);
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
