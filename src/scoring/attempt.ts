import type { DiffStats } from "../core/diff";
import { countWords } from "../core/chunk";

export interface AttemptScore {
  accuracy: number;
  completeness: number;
  fluency: number;
  overall: number;
}

/** 自然语速按 150 词/分钟 = 2.5 词/秒 估算 */
const WORDS_PER_SECOND = 2.5;
const FLUENCY_LOW = 0.85;
const FLUENCY_HIGH = 1.3;
const FLUENCY_MIN_RATIO = 0.4;
const FLUENCY_MAX_RATIO = 2.2;

export function scoreAttempt(
  expected: string,
  diff: DiffStats,
  durationMs: number,
): AttemptScore {
  const words = countWords(expected);
  if (words === 0) {
    return { accuracy: 0, completeness: 0, fluency: 0, overall: 0 };
  }

  const accuracy = diff.accuracy;
  const completeness = clamp100(((words - diff.missing) / words) * 100);
  const fluency = fluencyFromDuration(words, durationMs);
  const overall = Math.round(accuracy * 0.5 + completeness * 0.3 + fluency * 0.2);

  return { accuracy, completeness, fluency, overall };
}

function fluencyFromDuration(words: number, durationMs: number): number {
  if (durationMs <= 0) return 0;

  const expectedSeconds = words / WORDS_PER_SECOND;
  const ratio = durationMs / 1000 / expectedSeconds;

  if (ratio >= FLUENCY_LOW && ratio <= FLUENCY_HIGH) return 100;
  if (ratio < FLUENCY_LOW) {
    const span = FLUENCY_LOW - FLUENCY_MIN_RATIO;
    return clamp100(((ratio - FLUENCY_MIN_RATIO) / span) * 100);
  }
  const span = FLUENCY_MAX_RATIO - FLUENCY_HIGH;
  return clamp100(((FLUENCY_MAX_RATIO - ratio) / span) * 100);
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, round1(value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
