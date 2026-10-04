export interface PracticeContext {
  text: string;
  recognized: string;
  accuracy: number;
  completeness: number;
  fluency: number;
  missing: number;
  extra: number;
  wrong: number;
}

export interface PracticeCard {
  term: string;
  cloze: string;
}

export interface PracticeFeedback {
  explain: string;
  cards: PracticeCard[];
}

export const PRACTICE_PROMPT_PLACEHOLDERS = [
  "{{TEXT}}",
  "{{RECOGNIZED}}",
  "{{ACCURACY}}",
  "{{COMPLETENESS}}",
  "{{FLUENCY}}",
  "{{MISSING}}",
  "{{EXTRA}}",
  "{{WRONG}}",
] as const;

/**
 * 默认提示词。可被 vault 里的 _lingo/prompts/practice-review.md 覆盖。
 *
 * 两条硬规则来自设计文档：
 * - 13.3 **只解释，不翻译整句** —— 一旦知道中文意思，就不会再认真读英文了
 * - 13.2 **允许空结果** —— 否则模型会硬编出并不存在的问题
 */
export const DEFAULT_PRACTICE_PROMPT = [
  "你是一位英语发音与阅读练习的助手，服务对象是中文母语的学习者。",
  "",
  "下面是一次跟读练习的结果。请完成两件事，并且只输出 JSON。",
  "",
  "片段原文：{{TEXT}}",
  "语音识别结果：{{RECOGNIZED}}",
  "分数：准确度 {{ACCURACY}}／完整度 {{COMPLETENESS}}／流利度 {{FLUENCY}}",
  "差异：漏读 {{MISSING}} 处、多读 {{EXTRA}} 处、读错 {{WRONG}} 处",
  "",
  "要求：",
  "1. explain：用一句中文说明这次最值得注意的问题；表现好就给一句简短肯定。",
  "   绝对不要翻译整句，也不要复述原文。可以点出具体的词或发音难点。",
  "2. cards：最多挑 2 个值得反复练习的词。cloze 是把该词在原句中挖空后的句子。",
  "   没有合适的词就返回空数组，不要硬凑。",
  "",
  "只输出下面这个 JSON，不要任何额外文字：",
  '{"explain": "一句话说明", "cards": [{"term": "单词", "cloze": "挖空后的原句"}]}',
].join("\n");

/** 用练习上下文填充提示词模板。未知占位符原样保留，便于排查。 */
export function renderPrompt(template: string, context: PracticeContext): string {
  const values: Record<string, string> = {
    TEXT: context.text,
    RECOGNIZED: context.recognized || "（没有识别到内容）",
    ACCURACY: String(context.accuracy),
    COMPLETENESS: String(context.completeness),
    FLUENCY: String(context.fluency),
    MISSING: String(context.missing),
    EXTRA: String(context.extra),
    WRONG: String(context.wrong),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in values ? values[name] : match,
  );
}

/**
 * 解析模型返回的反馈。
 *
 * **故意做成宽容的**：真实模型经常给 JSON 套上代码块、或在前后加一句客套话。
 * 因为格式不符就整个失败，比给出一段不完美的解释糟糕得多 —— 后者至少还能读。
 */
export function parseFeedback(raw: string): PracticeFeedback {
  const json = extractJsonObject(raw);
  if (json !== undefined) {
    try {
      return normalizeFeedback(JSON.parse(json));
    } catch {
      // 落到下面的兜底
    }
  }
  return { explain: raw.trim(), cards: [] };
}

function normalizeFeedback(value: unknown): PracticeFeedback {
  if (!value || typeof value !== "object") return { explain: "", cards: [] };
  const node = value as { explain?: unknown; cards?: unknown };

  const explain = typeof node.explain === "string" ? node.explain.trim() : "";
  const cards: PracticeCard[] = [];

  if (Array.isArray(node.cards)) {
    for (const item of node.cards) {
      if (!item || typeof item !== "object") continue;
      const card = item as { term?: unknown; cloze?: unknown };
      if (typeof card.term !== "string" || typeof card.cloze !== "string") continue;
      if (card.term.trim() === "" || card.cloze.trim() === "") continue;
      cards.push({ term: card.term.trim(), cloze: card.cloze.trim() });
      if (cards.length >= 2) break;
    }
  }

  return { explain, cards };
}

function extractJsonObject(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}
