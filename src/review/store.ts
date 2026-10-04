import { App } from "obsidian";
import {
  applyQueueChecks,
  buildCardsFile,
  buildQueueFile,
  createCard,
  hasCardFor,
  makeCardId,
  parseCards,
  parseQueueChecks,
  selectDueCards,
  type ReviewCard,
} from "./cards";

export const REVIEW_DIR = "_lingo";
export const CARDS_PATH = "_lingo/cards.md";
export const REVIEW_PATH = "_lingo/review.md";

export async function readCards(app: App): Promise<ReviewCard[]> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(CARDS_PATH))) return [];
  try {
    return parseCards(await adapter.read(CARDS_PATH));
  } catch {
    return [];
  }
}

export async function writeCards(app: App, cards: ReviewCard[]): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(REVIEW_DIR))) await adapter.mkdir(REVIEW_DIR);
  await adapter.write(CARDS_PATH, buildCardsFile(cards));
}

/**
 * 追加新卡片，跳过已经存在的（按 id 去重）。
 *
 * 返回实际写入的数量 —— 界面上要能说清"这次加了几张"，
 * 而不是让用户以为每次都加了一堆重复的。
 */
export async function addCards(app: App, incoming: ReviewCard[]): Promise<number> {
  const existing = await readCards(app);
  const known = new Set(existing.map((card) => card.id));
  const fresh = incoming.filter(
    (card) => !known.has(card.id) && !hasCardFor(existing, card.term, card.source),
  );
  if (fresh.length === 0) return 0;
  await writeCards(app, [...existing, ...fresh]);
  return fresh.length;
}

export interface AddTermResult {
  ok: boolean;
  /** 失败原因，直接可以展示给用户。 */
  reason?: string;
  id?: string;
}

/**
 * 把一个词加进闪卡，用它所在的句子作为语境。
 *
 * 语境句是必须的：卡片背面靠它提供回忆线索（设计文档 9.2），
 * 只有词没有句子的卡片在复习时几乎帮不上忙。
 */
export async function addTermCard(
  app: App,
  term: string,
  sentence: string,
  source: string,
  today: Date,
): Promise<AddTermResult> {
  const cleanTerm = term.trim();
  if (cleanTerm === "") return { ok: false, reason: "没有可添加的词。" };
  if (source === "") return { ok: false, reason: "无法确定来源笔记。" };

  const cards = await readCards(app);
  if (hasCardFor(cards, cleanTerm, source)) {
    return { ok: false, reason: `「${cleanTerm}」在这一篇里已经有卡片了。` };
  }

  // 语境句为空时退回用词本身，至少让卡片不是空的
  const context = sentence.trim() === "" ? cleanTerm : sentence.trim();
  const id = makeCardId(
    cards.map((card) => card.id),
    cleanTerm,
  );
  await writeCards(app, [...cards, createCard(id, cleanTerm, context, source, today)]);
  return { ok: true, id };
}

export interface QueueResult {
  /** 本次进入队列的卡片数。 */
  queued: number;
  /** 上次勾选「记得」并被推进的卡片数。 */
  advanced: number;
}

/** 生成今日复习队列：先消化上次的勾选结果，再投影出今天的清单。 */
export async function generateReviewQueue(
  app: App,
  today: Date,
): Promise<QueueResult> {
  const adapter = app.vault.adapter;
  const cards = await readCards(app);

  // 先读上一份队列的勾选状态。这一步必须在覆盖 review.md 之前做，
  // 否则上一轮的结果就被自己抹掉了。
  let advanced = 0;
  let updated = cards;
  if (await adapter.exists(REVIEW_PATH)) {
    try {
      const checks = parseQueueChecks(await adapter.read(REVIEW_PATH));
      updated = applyQueueChecks(cards, checks, today);
      advanced = updated.filter((card, index) => card.step !== cards[index].step).length;
      if (advanced > 0) await writeCards(app, updated);
    } catch {
      // 队列文件读坏了就跳过消化，不影响重新生成
    }
  }

  await adapter.write(REVIEW_PATH, buildQueueFile(updated, today));
  return { queued: selectDueCards(updated, today).length, advanced };
}
