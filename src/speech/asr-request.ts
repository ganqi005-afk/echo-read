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
      sample_rate: options.sampleRate ?? 16000,
    },
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
  const output = (payload as LooseRecord).output;
  if (!output || typeof output !== "object") return undefined;
  const node = output as LooseRecord;

  if (typeof node.text === "string") return node.text;

  const choices = node.choices;
  if (Array.isArray(choices) && choices.length > 0) {
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
  }

  const results = node.results;
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as LooseRecord | undefined;
    if (typeof first?.transcription === "string") return first.transcription;
    if (typeof first?.text === "string") return first.text;
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
