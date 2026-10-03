export type DiffKind = "ok" | "missing" | "extra" | "wrong";

export interface DiffToken {
  kind: DiffKind;
  expected?: string;
  actual?: string;
}

export interface DiffStats {
  total: number;
  correct: number;
  missing: number;
  extra: number;
  wrong: number;
  accuracy: number;
}

export interface DiffResult {
  tokens: DiffToken[];
  stats: DiffStats;
}

const SPELLING_EQUIVALENTS: Record<string, string> = {
  colour: "color", colours: "colors", favour: "favor", honour: "honor",
  labour: "labor", neighbour: "neighbor", behaviour: "behavior",
  centre: "center", theatre: "theater", metre: "meter",
  organise: "organize", organised: "organized", realise: "realize",
  realised: "realized", recognise: "recognize", travelling: "traveling",
  cancelled: "canceled", programme: "program",
};

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11",
  twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60",
  seventy: "70", eighty: "80", ninety: "90", hundred: "100",
  thousand: "1000",
};

export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9']+(?:-[a-z0-9']+)*/g) ?? [];
  return raw.map((t) => t.replace(/^'+|'+$/g, "")).filter(Boolean);
}

export function canonicalize(word: string): string {
  const withoutHyphen = word.replace(/-/g, "");
  const spelled = SPELLING_EQUIVALENTS[withoutHyphen] ?? withoutHyphen;
  return NUMBER_WORDS[spelled] ?? spelled;
}

export function diffDictation(expected: string, actual: string): DiffResult {
  const e = tokenize(expected);
  const a = tokenize(actual);

  const rows = e.length + 1;
  const cols = a.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = canonicalize(e[i - 1]) === canonicalize(a[j - 1]);
      dp[i][j] = same
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = e.length;
  let j = a.length;
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && canonicalize(e[i - 1]) === canonicalize(a[j - 1]);
    if (i > 0 && j > 0 && same && dp[i][j] === dp[i - 1][j - 1]) {
      tokens.push({ kind: "ok", expected: e[i - 1], actual: a[j - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      tokens.push({ kind: "wrong", expected: e[i - 1], actual: a[j - 1] });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      tokens.push({ kind: "missing", expected: e[i - 1] });
      i--;
    } else {
      tokens.push({ kind: "extra", actual: a[j - 1] });
      j--;
    }
  }
  tokens.reverse();

  const stats: DiffStats = {
    total: e.length,
    correct: tokens.filter((t) => t.kind === "ok").length,
    missing: tokens.filter((t) => t.kind === "missing").length,
    extra: tokens.filter((t) => t.kind === "extra").length,
    wrong: tokens.filter((t) => t.kind === "wrong").length,
    accuracy: 0,
  };
  stats.accuracy = e.length === 0 ? 0 : Math.round((stats.correct / e.length) * 1000) / 10;

  return { tokens, stats };
}
