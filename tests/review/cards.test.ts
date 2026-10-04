import { describe, expect, it } from "vitest";
import {
  applyQueueChecks,
  blankOutTerm,
  buildCardsFile,
  buildQueueFile,
  createCard,
  hasCardFor,
  makeCardId,
  parseCards,
  parseQueueChecks,
  selectDueCards,
  serializeCard,
  type ReviewCard,
} from "../../src/review/cards";

const TODAY = new Date(2026, 9, 4);

function card(overrides: Partial<ReviewCard> = {}): ReviewCard {
  return {
    id: "c1",
    term: "postpone",
    front: "The committee decided to ____ the proposal.",
    back: "The committee decided to postpone the proposal.",
    source: "[[测试文章]]",
    step: 0,
    due: "2026-10-05",
    ...overrides,
  };
}

describe("blankOutTerm", () => {
  it("blanks the target word", () => {
    expect(blankOutTerm("Please postpone it.", "postpone")).toBe("Please ____ it.");
  });

  it("respects word boundaries", () => {
    // "art" 不该把 "start" 也挖掉
    expect(blankOutTerm("We start now.", "art")).toBe("We start now.");
  });

  it("is case-insensitive", () => {
    expect(blankOutTerm("Postpone it.", "postpone")).toBe("____ it.");
  });

  it("leaves the sentence intact when the term is absent", () => {
    expect(blankOutTerm("No match here.", "zzz")).toBe("No match here.");
  });

  it("handles a term containing regex metacharacters", () => {
    expect(blankOutTerm("Cost is e.g. high.", "e.g.")).toBe("Cost is ____ high.");
  });
});

describe("序列化与解析", () => {
  it("round-trips a card", () => {
    const original = card();
    expect(parseCards(serializeCard(original))).toEqual([original]);
  });

  it("survives a sentence containing quotes and newline-ish characters", () => {
    const tricky = card({ back: 'He said "the plan is ready." Then left.' });
    expect(parseCards(serializeCard(tricky))[0].back).toBe(tricky.back);
  });

  it("round-trips a whole file", () => {
    const cards = [card(), card({ id: "c2", term: "incomplete" })];
    expect(parseCards(buildCardsFile(cards))).toEqual(cards);
  });

  // 双向链接是"可见那一层"的职责，不能被塞进注释里就完事
  it("keeps the source link visible in the readable part", () => {
    const file = buildCardsFile([card()]);
    expect(file).toContain("来源：[[测试文章]]");
  });

  it("skips a corrupt entry instead of failing the whole file", () => {
    const file = `${serializeCard(card())}\n<!-- lingo-card {broken json} -->\n`;
    expect(parseCards(file)).toHaveLength(1);
  });
});

describe("createCard", () => {
  it("schedules a brand-new card one day out", () => {
    expect(createCard("c1", "postpone", "Please postpone it.", "[[n]]", TODAY).due).toBe(
      "2026-10-05",
    );
  });

  it("blanks the term into the front", () => {
    expect(createCard("c1", "postpone", "Please postpone it.", "[[n]]", TODAY).front).toBe(
      "Please ____ it.",
    );
  });
});

describe("makeCardId", () => {
  it("derives an id from the term", () => {
    expect(makeCardId([], "postpone")).toBe("postpone");
  });

  it("avoids collisions", () => {
    expect(makeCardId(["postpone"], "postpone")).toBe("postpone-2");
  });

  it("falls back for an unusable seed", () => {
    expect(makeCardId([], "///")).toBe("card");
  });
});

describe("hasCardFor", () => {
  // 只按 id 去重不够：makeCardId 遇到重名会生成 "postpone-2"，
  // 于是同一句话点两次「加入闪卡」会得到两张一模一样的卡
  it("detects a duplicate term from the same note", () => {
    expect(hasCardFor([card()], "postpone", "[[测试文章]]")).toBe(true);
  });

  it("ignores case and surrounding spaces", () => {
    expect(hasCardFor([card()], "  Postpone ", "[[测试文章]]")).toBe(true);
  });

  it("allows the same word from a different note", () => {
    expect(hasCardFor([card()], "postpone", "[[另一篇]]")).toBe(false);
  });

  it("allows a different word from the same note", () => {
    expect(hasCardFor([card()], "incomplete", "[[测试文章]]")).toBe(false);
  });
});

describe("今日队列", () => {
  it("selects only cards that are due", () => {
    const cards = [card({ id: "a", due: "2026-10-04" }), card({ id: "b", due: "2026-12-01" })];
    expect(selectDueCards(cards, TODAY).map((item) => item.id)).toEqual(["a"]);
  });

  it("puts the most overdue first", () => {
    const cards = [
      card({ id: "new", due: "2026-10-04" }),
      card({ id: "old", due: "2026-09-01" }),
    ];
    expect(selectDueCards(cards, TODAY).map((item) => item.id)).toEqual(["old", "new"]);
  });

  it("says so plainly when nothing is due", () => {
    expect(buildQueueFile([card({ due: "2030-01-01" })], TODAY)).toContain("今天没有到期的卡片");
  });

  it("writes a checkbox and a hidden id per card", () => {
    const queue = buildQueueFile([card({ due: "2026-10-04" })], TODAY);
    expect(queue).toContain("- [ ] ");
    expect(queue).toContain("<!-- lingo-c1 -->");
  });
});

describe("勾选回读", () => {
  it("reads checked and unchecked lines", () => {
    const markdown = [
      "- [x] first <!-- lingo-a -->",
      "- [ ] second <!-- lingo-b -->",
    ].join("\n");
    const checks = parseQueueChecks(markdown);
    expect(checks.get("a")).toBe(true);
    expect(checks.get("b")).toBe(false);
  });

  it("advances only the checked cards", () => {
    const cards = [card({ id: "a" }), card({ id: "b" })];
    const updated = applyQueueChecks(cards, new Map([["a", true]]), TODAY);
    expect(updated[0].step).toBe(1);
    expect(updated[1].step).toBe(0);
  });

  // 没勾 = 忘了 → 重置。这是间隔重复的核心：忘掉的卡必须重走整条曲线，
  // 否则"反复读错的卡最后读对时从第 6 档继续往前推"，调度就退化成单向递增了。
  it("resets an unchecked card to the first step", () => {
    const cards = [card({ id: "b", step: 3, due: "2026-09-01" })];
    const updated = applyQueueChecks(cards, new Map([["b", false]]), TODAY);
    expect(updated[0].step).toBe(0);
    expect(updated[0].due).toBe("2026-10-05");
  });

  // 不在队列里 = 还没轮到它，不能因为"没勾"就重置
  it("leaves cards that were not in the queue untouched", () => {
    const cards = [card({ id: "zzz", step: 2 })];
    expect(applyQueueChecks(cards, new Map(), TODAY)[0].step).toBe(2);
  });
});
