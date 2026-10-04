// 称呼与缩略语：几乎不会出现在句末，永远不在此断开
const TITLES = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc",
  "no", "fig", "eq", "inc", "ltd", "co", "approx",
]);

// 首字母缩写：既可能是句中，也可能是句末，靠后一个词的词首大小写判断
const ACRONYMS = new Set(["e.g", "i.e", "u.s", "u.k", "a.m", "p.m"]);

const CLOSERS = new Set(['"', "'", "\u201d", "\u2019", ")", "]", "\u00bb"]);
const ENDERS = new Set([".", "!", "?", "\u2026"]);

export interface SentenceRange {
  start: number;
  end: number;
  text: string;
}

/**
 * 在**原始文本**上分句，并返回偏移量。
 *
 * 为什么需要偏移：阅读视图的装饰必须知道每个句子落在原文的哪个区间，
 * 才能精确切分文本节点。只返回句子字符串是不够的。
 */
export function splitSentenceRanges(text: string): SentenceRange[] {
  const out: SentenceRange[] = [];
  let start = 0;
  let i = 0;

  while (i < text.length) {
    if (!ENDERS.has(text[i])) {
      i++;
      continue;
    }

    let j = i;
    while (j < text.length && ENDERS.has(text[j])) j++;

    let k = j;
    while (k < text.length && CLOSERS.has(text[k])) k++;

    const next = text[k];
    if (next !== undefined && !isWhitespace(next)) {
      i = k;
      continue;
    }

    if (text[i] === ".") {
      const token = tokenBefore(text, i);
      if (TITLES.has(token)) {
        i = j;
        continue;
      }
      if (ACRONYMS.has(token) && !nextWordStartsUppercase(text, k)) {
        i = j;
        continue;
      }
      if (isDecimal(text, i)) {
        i = j;
        continue;
      }
    }

    pushRange(out, text, start, k);
    start = k;
    i = k;
  }

  pushRange(out, text, start, text.length);
  return out;
}

/**
 * 保留原签名，复用范围版本 —— 两份扫描逻辑会随时间漂移，
 * 那是最难发现的一类 bug。
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  return splitSentenceRanges(normalized).map((range) => range.text);
}

function pushRange(out: SentenceRange[], text: string, from: number, to: number): void {
  let start = from;
  let end = to;
  while (start < end && isWhitespace(text[start])) start++;
  while (end > start && isWhitespace(text[end - 1])) end--;
  if (end > start) out.push({ start, end, text: text.slice(start, end) });
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
}

function tokenBefore(s: string, dotIndex: number): string {
  let p = dotIndex - 1;
  while (p >= 0 && /[A-Za-z.]/.test(s[p])) p--;
  return s.slice(p + 1, dotIndex).toLowerCase();
}

function nextWordStartsUppercase(s: string, from: number): boolean {
  let p = from;
  while (p < s.length && isWhitespace(s[p])) p++;
  if (p >= s.length) return true;
  return /[A-Z]/.test(s[p]);
}

function isDecimal(s: string, dotIndex: number): boolean {
  const prev = s[dotIndex - 1];
  const next = s[dotIndex + 1];
  return prev !== undefined && next !== undefined && /\d/.test(prev) && /\d/.test(next);
}
