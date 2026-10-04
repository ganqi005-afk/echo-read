import { App } from "obsidian";
import {
  applyQueueChecks,
  buildCardsFile,
  buildQueueFile,
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
  const fresh = incoming.filter((card) => !known.has(card.id));
  if (fresh.length === 0) return 0;
  await writeCards(app, [...existing, ...fresh]);
  return fresh.length;
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
