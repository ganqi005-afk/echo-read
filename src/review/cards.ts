import { addDays, intervalForStep, isDue, nextSchedule, toDateString } from "./schedule";

export interface ReviewCard {
  id: string;
  /** 被挖空的那个词。 */
  term: string;
  /** 正面：挖空后的原句。 */
  front: string;
  /** 背面：完整原句。 */
  back: string;
  /** 来源笔记，形如 [[笔记名]]。双向链接就靠它。 */
  source: string;
  step: number;
  /** 下次复习日期 YYYY-MM-DD。 */
  due: string;
}

const META_PATTERN = /<!--\s*lingo-card\s+(\{[\s\S]*?\})\s*-->/g;
const CHECK_PATTERN = /^-\s*\[( |x|X)\]\s*(.*?)<!--\s*lingo-(\S+?)\s*-->\s*$/;

// 序列化成 Markdown。
//
// 刻意做成"人看得懂 + 机器读得到"两层：
// - 可见的那一行是正常 Markdown，含 [[来源笔记]]，双向链接靠它生效
// - 机器数据藏在单行 JSON 注释里，不干扰阅读
//
// 不用 key=value 属性串，是因为句子里的引号和空格会让解析变得很脆弱。
export function serializeCard(card: ReviewCard): string {
  const meta = JSON.stringify(card);
  return [
    `- **${card.front}**`,
    `  - 答案：${card.back}`,
    `  - 来源：${card.source}　·　第 ${card.step + 1} 档　·　下次 ${card.due}`,
    `  <!-- lingo-card ${meta} -->`,
  ].join("\n");
}

export function parseCards(markdown: string): ReviewCard[] {
  const cards: ReviewCard[] = [];
  for (const match of markdown.matchAll(META_PATTERN)) {
    try {
      const parsed = JSON.parse(match[1]) as Partial<ReviewCard>;
      if (typeof parsed.id !== "string" || parsed.id === "") continue;
      cards.push({
        id: parsed.id,
        term: typeof parsed.term === "string" ? parsed.term : "",
        front: typeof parsed.front === "string" ? parsed.front : "",
        back: typeof parsed.back === "string" ? parsed.back : "",
        source: typeof parsed.source === "string" ? parsed.source : "",
        step: typeof parsed.step === "number" ? parsed.step : 0,
        due: typeof parsed.due === "string" ? parsed.due : "",
      });
    } catch {
      // 单条坏掉不该让整个文件读不出来
    }
  }
  return cards;
}

export function selectDueCards(cards: ReviewCard[], today: Date): ReviewCard[] {
  return cards
    .filter((card) => isDue(card.due, today))
    .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
}

/** 读复习队列里的勾选状态：true 表示「记得」。 */
export function parseQueueChecks(markdown: string): Map<string, boolean> {
  const checks = new Map<string, boolean>();
  for (const line of markdown.split("\n")) {
    const match = CHECK_PATTERN.exec(line);
    if (!match) continue;
    checks.set(match[3], match[1].toLowerCase() === "x");
  }
  return checks;
}

// 把上一份队列里的勾选结果应用到卡片上。
//
// 三个分支，缺一不可：
// - 在队列里且勾选 → 记得 → 进下一档
// - 在队列里但没勾 → 忘了 → **重置到第一档**
// - 不在队列里 → 它还没轮到，原样不动
//
// 第二条是间隔重复的核心。之前只做了第一条，结果是：
// 一张反复读错的卡最后读对时会从第 6 档继续往前推，而不是重走曲线 ——
// 那样"忘了"这个分支等于不存在，整个调度退化成单向递增。
export function applyQueueChecks(
  cards: ReviewCard[],
  checks: Map<string, boolean>,
  today: Date,
): ReviewCard[] {
  return cards.map((card) => {
    const remembered = checks.get(card.id);
    if (remembered === undefined) return card;

    const next = nextSchedule(card.step, remembered, today);
    return { ...card, step: next.step, due: next.due };
  });
}

export function buildCardsFile(cards: ReviewCard[]): string {
  const header = [
    "# Echo Read 复习卡片",
    "",
    "这个文件由插件维护。可见部分是正常 Markdown，`[[来源笔记]]` 会让来源笔记的",
    "反向链接面板里出现这里 —— 双向引用就是这样自动建立的。",
    "",
    "注释里的数据不要手改。",
    "",
  ];
  return [...header, ...cards.map(serializeCard), ""].join("\n");
}

// 生成今日队列。
//
// 队列是 cards.md 的**投影**，随时可以删掉重建 —— 真正的数据只有一份，
// 就是 cards.md。这条原则保证队列文件不会变成第二个数据源。
export function buildQueueFile(cards: ReviewCard[], today: Date): string {
  const due = selectDueCards(cards, today);
  const lines = [
    `# 今日复习 · ${toDateString(today)}`,
    "",
    due.length === 0
      ? "今天没有到期的卡片。"
      : `共 ${due.length} 张。**勾选表示「记得」**，推进到下一档；` +
        `**没勾表示「忘了」**，下一轮会重走整条曲线。`,
    "",
  ];

  for (const card of due) {
    lines.push(`- [ ] ${card.front} <!-- lingo-${card.id} -->`);
    lines.push(`\t> [!quote]- 答案${card.term ? ` · ${card.term}` : ""}`);
    lines.push(`\t> ${card.back}`);
    lines.push(`\t> 来源：${card.source}　·　${intervalForStep(card.step)} 天档`);
    lines.push("");
  }

  return lines.join("\n");
}

export function makeCardId(existing: string[], seed: string): string {
  const base = seed.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "card";
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

export function createCard(
  id: string,
  term: string,
  fullSentence: string,
  source: string,
  today: Date,
): ReviewCard {
  return {
    id,
    term,
    front: blankOutTerm(fullSentence, term),
    back: fullSentence,
    source,
    step: 0,
    due: toDateString(addDays(today, intervalForStep(0))),
  };
}

// 把目标词在原句里挖空。
//
// 词边界只在**首尾确实是词字符**时才加：`\b` 要求交界一侧是词字符，
// 而 "e.g." 以句点结尾，句点后面没有边界，加了两头都会匹配不上。
// 首字母仍加边界，这样 "art" 不会把 "start" 也挖掉。
// 匹配不到就原样返回 —— 与其生成一张正面等于背面的废卡，不如让它至少完整。
export function blankOutTerm(sentence: string, term: string): string {
  const target = term.trim();
  if (target === "") return sentence;

  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = /^\w/.test(target) ? "\\b" : "";
  const tail = /\w$/.test(target) ? "\\b" : "";
  const pattern = new RegExp(`${head}${escaped}${tail}`, "i");

  if (!pattern.test(sentence)) return sentence;
  return sentence.replace(pattern, "____");
}
