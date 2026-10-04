export interface AsrRequestOptions {
  model: string;
  audioDataUri: string;
  sampleRate?: number;
  format?: string;
}

export function buildAsrBody(options: AsrRequestOptions): unknown {
  return {
    model: options.model,
    input: {
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: options.audioDataUri } },
          ],
        },
      ],
    },
    parameters: {
      format: options.format ?? "wav",
      // 官方示例里 sample_rate 是**字符串**（"16000"），不是数字。
      // 按文档逐字对齐，避免服务端因类型不符直接拒绝。
      sample_rate: String(options.sampleRate ?? 16000),
    },
  };
}

/**
 * OpenAI 兼容端点（例如百炼 Token Plan）的请求体。
 *
 * 注意一个反直觉的地方：`input_audio.data` 要传**完整的 Base64 Data URL**
 * （带 `data:audio/wav;base64,` 前缀），而不是 OpenAI 官方规范里的纯 base64。
 * 依据：百炼「OpenAI 兼容-Chat」参数说明 ——「音频的 URL 或 Base64 Data URL」；
 * 以及「Qwen-ASR API 参考」的示例 ——「data:audio/wav;base64,SUQzBAAA...」。
 * 曾经剥掉前缀，结果是 HTTP 400。
 */
export function buildOpenAiCompatibleBody(options: AsrRequestOptions): unknown {
  return {
    model: options.model,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: options.audioDataUri,
              format: options.format ?? "wav",
            },
          },
        ],
      },
    ],
  };
}

/**
 * 文档没有给出完整响应示例，因此按已知的几种形态依次尝试。
 * 全部失败时抛错并附带原始响应，便于一次性校正。
 */
export function extractTranscript(payload: unknown): string {
  const text = tryExtract(payload);
  if (text !== undefined && text.trim() !== "") return text.trim();
  throw new Error(`无法从响应中提取识别文本。原始响应：${safeStringify(payload)}`);
}

interface LooseRecord {
  [key: string]: unknown;
}

function tryExtract(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as LooseRecord;

  // OpenAI 兼容格式：choices 在顶层
  const direct = readChoices(root);
  if (direct !== undefined) return direct;

  const output = root.output;
  if (!output || typeof output !== "object") return undefined;
  const node = output as LooseRecord;

  if (typeof node.text === "string") return node.text;

  const nested = readChoices(node);
  if (nested !== undefined) return nested;

  const results = node.results;
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as LooseRecord | undefined;
    if (typeof first?.transcription === "string") return first.transcription;
    if (typeof first?.text === "string") return first.text;
  }

  return undefined;
}

function readChoices(node: LooseRecord): string | undefined {
  const choices = node.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;

  const message = (choices[0] as LooseRecord | undefined)?.message;
  const content = (message as LooseRecord | undefined)?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        const text = (part as LooseRecord | undefined)?.text;
        return typeof text === "string" ? text : "";
      })
      .join("");
    if (joined.trim() !== "") return joined;
  }
  return undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 800);
  } catch {
    return "[无法序列化的响应]";
  }
}
