import { describe, expect, it } from "vitest";
import {
  EBBINGHAUS_INTERVALS,
  addDays,
  describeStep,
  intervalForStep,
  isDue,
  nextSchedule,
  parseDateString,
  toDateString,
} from "../../src/review/schedule";

const TODAY = new Date(2026, 9, 4); // 2026-10-04 本地时间

describe("日期处理", () => {
  it("formats in local time, not UTC", () => {
    // 用 toISOString 实现的话，东八区的凌晨会算成前一天
    expect(toDateString(new Date(2026, 9, 4, 0, 30))).toBe("2026-10-04");
  });

  it("adds days across a month boundary", () => {
    expect(toDateString(addDays(new Date(2026, 9, 30), 4))).toBe("2026-11-03");
  });

  it("round-trips a date string", () => {
    expect(toDateString(parseDateString("2026-10-04")!)).toBe("2026-10-04");
  });

  it("rejects malformed date strings", () => {
    expect(parseDateString("2026/10/04")).toBeUndefined();
    expect(parseDateString("tomorrow")).toBeUndefined();
  });
});

describe("isDue", () => {
  it("treats today and earlier as due", () => {
    expect(isDue("2026-10-04", TODAY)).toBe(true);
    expect(isDue("2026-10-01", TODAY)).toBe(true);
  });

  it("treats later dates as not due", () => {
    expect(isDue("2026-10-05", TODAY)).toBe(false);
  });

  // 坏掉的日期不能把卡片永久埋住
  it("treats an unparseable date as due", () => {
    expect(isDue("", TODAY)).toBe(true);
    expect(isDue("garbage", TODAY)).toBe(true);
  });
});

describe("nextSchedule", () => {
  it("uses the first interval on a fresh card", () => {
    // 新卡片的首次复习在 1 天后 —— 那是卡创建时的排程，不是"复习成功"的结果
    expect(toDateString(addDays(TODAY, intervalForStep(0)))).toBe("2026-10-05");
  });

  it("moves to the second interval after the first successful review", () => {
    expect(nextSchedule(0, true, TODAY)).toEqual({ step: 1, due: "2026-10-06" });
  });

  it("advances one step when remembered", () => {
    expect(nextSchedule(1, true, TODAY)).toEqual({ step: 2, due: "2026-10-08" });
  });

  // 间隔重复的核心：忘掉就必须重走整条曲线，而不是只退一档
  it("resets to the first step when forgotten", () => {
    expect(nextSchedule(5, false, TODAY)).toEqual({ step: 0, due: "2026-10-05" });
  });

  it("caps at the last interval instead of running off the end", () => {
    const last = EBBINGHAUS_INTERVALS.length - 1;
    expect(nextSchedule(last, true, TODAY).step).toBe(last);
  });

  it("keeps the shape of the forgetting curve: intervals only grow", () => {
    for (let i = 1; i < EBBINGHAUS_INTERVALS.length; i++) {
      expect(EBBINGHAUS_INTERVALS[i]).toBeGreaterThan(EBBINGHAUS_INTERVALS[i - 1]);
    }
  });

  it("survives a corrupt step value", () => {
    expect(nextSchedule(Number.NaN, true, TODAY).step).toBe(1);
    expect(nextSchedule(-5, true, TODAY).step).toBe(1);
  });
});

describe("显示", () => {
  it("maps a step to its interval", () => {
    expect(intervalForStep(0)).toBe(1);
    expect(intervalForStep(3)).toBe(7);
  });

  it("clamps an out-of-range step", () => {
    expect(intervalForStep(99)).toBe(90);
    expect(intervalForStep(-1)).toBe(1);
  });

  it("describes the step in human terms", () => {
    expect(describeStep(2)).toContain("4 天后");
  });
});
