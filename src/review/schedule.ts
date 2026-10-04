/**
 * 艾宾浩斯遗忘曲线的**日粒度近似**。
 *
 * 经典实验给出的复习点是 5 分钟 / 30 分钟 / 12 小时 / 1 天 / 2 天 / 4 天 / 7 天 / 15 天。
 * 其中前三个都在一天之内，而本插件的复习队列是**按天**组织的 Markdown 文件 ——
 * 为了三个小时内复习三次去引入小时级调度，收益远小于复杂度。
 *
 * 因此保留曲线的形状（间隔不断拉长），从「天」开始：
 * 1 → 2 → 4 → 7 → 15 → 30 → 90。
 *
 * 这个取舍是刻意的，不是漏掉了前半段。
 */
export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30, 90] as const;

export interface ScheduleState {
  /** 当前处在第几档（0 表示刚学）。 */
  step: number;
  /** 下次复习日期，YYYY-MM-DD。 */
  due: string;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** 归一化成本地时区的 YYYY-MM-DD —— 用 toISOString 会因为时区偏移而差一天。 */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateString(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** 是否已到复习日期。无有效日期时视为到期，避免卡片被永久埋住。 */
export function isDue(due: string, today: Date): boolean {
  const parsed = parseDateString(due);
  if (!parsed) return true;
  return toDateString(parsed) <= toDateString(today);
}

/**
 * 推进或重置一张卡的排程。
 *
 * 「记得」进下一档；「忘了」回到第一档 —— 这是间隔重复的核心机制：
 * 忘掉的卡片必须重新走完整条曲线，而不是只退一档。
 */
export function nextSchedule(step: number, remembered: boolean, today: Date): ScheduleState {
  const safeStep = Number.isFinite(step) && step >= 0 ? Math.trunc(step) : 0;
  const nextStep = remembered ? Math.min(safeStep + 1, EBBINGHAUS_INTERVALS.length - 1) : 0;
  const interval = EBBINGHAUS_INTERVALS[nextStep];
  return { step: nextStep, due: toDateString(addDays(today, interval)) };
}

export function intervalForStep(step: number): number {
  const safeStep = Number.isFinite(step) ? Math.trunc(step) : 0;
  return EBBINGHAUS_INTERVALS[Math.max(0, Math.min(safeStep, EBBINGHAUS_INTERVALS.length - 1))];
}

/** 给界面用的一句话描述，例如「第 3 档 · 7 天后」。 */
export function describeStep(step: number): string {
  const safeStep = Math.max(0, Math.min(Math.trunc(step), EBBINGHAUS_INTERVALS.length - 1));
  return `第 ${safeStep + 1} 档 · ${EBBINGHAUS_INTERVALS[safeStep]} 天后`;
}
