// 称呼与缩略语：几乎不会出现在句末，永远不在此断开
const TITLES = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc",
  "no", "fig", "eq", "inc", "ltd", "co", "approx",
]);

// 首字母缩写：既可能是句中，也可能是句末，靠后一个词的词首大小写判断
const ACRONYMS = new Set(["e.g", "i.e", "u.s", "u.k", "a.m", "p.m"]);

const CLOSERS = new Set(['"', "'", "\u201d", "\u2019", ")", "]", "\u00bb"]);
const ENDERS = new Set([".", "!", "?", "\u2026"]);

export function splitSentences(text: string): string[] {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return [];

  const out: string[] = [];
  let start = 0;
  let i = 0;

  while (i < s.length) {
    if (!ENDERS.has(s[i])) {
      i++;
      continue;
    }

    let j = i;
    while (j < s.length && ENDERS.has(s[j])) j++;

    let k = j;
    while (k < s.length && CLOSERS.has(s[k])) k++;

    const next = s[k];
    if (next !== undefined && next !== " ") {
      i = k;
      continue;
    }

    if (s[i] === ".") {
      const token = tokenBefore(s, i);
      if (TITLES.has(token)) {
        i = j;
        continue;
      }
      if (ACRONYMS.has(token) && !nextWordStartsUppercase(s, k)) {
        i = j;
        continue;
      }
      if (isDecimal(s, i)) {
        i = j;
        continue;
      }
    }

    const piece = s.slice(start, k).trim();
    if (piece) out.push(piece);
    start = k;
    i = k;
  }

  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function tokenBefore(s: string, dotIndex: number): string {
  let p = dotIndex - 1;
  while (p >= 0 && /[A-Za-z.]/.test(s[p])) p--;
  return s.slice(p + 1, dotIndex).toLowerCase();
}

function nextWordStartsUppercase(s: string, from: number): boolean {
  let p = from;
  while (p < s.length && s[p] === " ") p++;
  if (p >= s.length) return true;
  return /[A-Z]/.test(s[p]);
}

function isDecimal(s: string, dotIndex: number): boolean {
  const prev = s[dotIndex - 1];
  const next = s[dotIndex + 1];
  return prev !== undefined && next !== undefined && /\d/.test(prev) && /\d/.test(next);
}
