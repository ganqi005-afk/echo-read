import { describe, expect, it } from "vitest";
import {
  buildCacheKey,
  formatBytes,
  pruneIndexEntries,
  recentIndexEntries,
  selectForRemoval,
  summarizeCache,
  toHex,
  upsertIndexEntry,
  type AudioIndex,
  type CacheEntry,
} from "../../src/store/audio-cache";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY; // 固定"现在"，避免测试依赖真实时间

describe("toHex", () => {
  it("renders bytes as two-digit lowercase hex", () => {
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe("000fff");
  });

  it("pads single-digit bytes", () => {
    expect(toHex(new Uint8Array([1]).buffer)).toBe("01");
  });
});

describe("buildCacheKey", () => {
  const base = { text: "Hello.", voice: "v1", model: "m1", format: "mp3" };

  it("is stable for identical inputs", () => {
    expect(buildCacheKey(base)).toBe(buildCacheKey({ ...base }));
  });

  // 设计文档 12.3 的核心：换任何一项都必须换缓存键，
  // 否则会命中旧音频，出现"换了音色但声音没变"这种极难排查的问题
  it("changes when the text changes", () => {
    expect(buildCacheKey({ ...base, text: "Bye." })).not.toBe(buildCacheKey(base));
  });

  it("changes when the voice changes", () => {
    expect(buildCacheKey({ ...base, voice: "v2" })).not.toBe(buildCacheKey(base));
  });

  it("changes when the model changes", () => {
    expect(buildCacheKey({ ...base, model: "m2" })).not.toBe(buildCacheKey(base));
  });

  it("changes when the format changes", () => {
    expect(buildCacheKey({ ...base, format: "wav" })).not.toBe(buildCacheKey(base));
  });

  it("does not collide when fields shift across the separator", () => {
    const a = buildCacheKey({ text: "b", voice: "a", model: "m", format: "f" });
    const b = buildCacheKey({ text: "a", voice: "b", model: "m", format: "f" });
    expect(a).not.toBe(b);
  });
});

function entry(path: string, ageDays: number, size: number): CacheEntry {
  return { path, mtime: NOW - ageDays * DAY, size };
}

describe("summarizeCache", () => {
  it("counts files and sums their size", () => {
    expect(summarizeCache([entry("a", 1, 100), entry("b", 2, 250)])).toEqual({
      count: 2,
      bytes: 350,
    });
  });

  it("reports zero for an empty cache", () => {
    expect(summarizeCache([])).toEqual({ count: 0, bytes: 0 });
  });
});

describe("selectForRemoval", () => {
  it("removes entries older than the age limit", () => {
    const entries = [entry("old", 40, 10), entry("fresh", 2, 10)];
    const doomed = selectForRemoval(entries, { maxAgeDays: 30, maxBytes: 0, now: NOW });
    expect(doomed.map((item) => item.path)).toEqual(["old"]);
  });

  it("keeps everything when the age limit is disabled", () => {
    const entries = [entry("ancient", 9999, 10)];
    expect(selectForRemoval(entries, { maxAgeDays: 0, maxBytes: 0, now: NOW })).toEqual([]);
  });

  it("trims by size from the oldest once the age pass is done", () => {
    const entries = [
      entry("newest", 1, 100),
      entry("middle", 5, 100),
      entry("oldest", 9, 100),
    ];
    const doomed = selectForRemoval(entries, { maxAgeDays: 0, maxBytes: 250, now: NOW });
    // 超出 50，删掉最旧的一个就够，不该多删
    expect(doomed.map((item) => item.path)).toEqual(["oldest"]);
  });

  it("keeps recent entries when they alone fit the budget", () => {
    const entries = [entry("recent", 1, 200), entry("stale", 20, 50)];
    const doomed = selectForRemoval(entries, { maxAgeDays: 0, maxBytes: 200, now: NOW });
    expect(doomed.map((item) => item.path)).toEqual(["stale"]);
  });

  it("does nothing when everything already fits", () => {
    const entries = [entry("a", 1, 10), entry("b", 2, 10)];
    expect(selectForRemoval(entries, { maxAgeDays: 30, maxBytes: 1000, now: NOW })).toEqual([]);
  });

  it("never returns an entry twice when both rules apply", () => {
    const entries = [entry("ancient", 100, 500)];
    const doomed = selectForRemoval(entries, { maxAgeDays: 30, maxBytes: 10, now: NOW });
    expect(doomed.map((item) => item.path)).toEqual(["ancient"]);
  });
});

describe("formatBytes", () => {
  it("scales the unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("audio index", () => {
  const entry = (text: string, file: string, createdAt: number) => ({
    text,
    voice: "v",
    model: "m",
    format: "mp3",
    file,
    createdAt,
  });

  it("adds and replaces entries by hash", () => {
    const first = upsertIndexEntry({}, "h1", entry("one", "a.mp3", 1));
    const second = upsertIndexEntry(first, "h1", entry("one updated", "a.mp3", 2));
    expect(Object.keys(second)).toEqual(["h1"]);
    expect(second.h1.text).toBe("one updated");
  });

  it("returns the most recent entries first", () => {
    const index: AudioIndex = {
      a: entry("old", "a.mp3", 1),
      b: entry("new", "b.mp3", 3),
      c: entry("middle", "c.mp3", 2),
    };
    expect(recentIndexEntries(index, 2).map((item) => item.text)).toEqual(["new", "middle"]);
  });

  it("handles a zero limit without throwing", () => {
    expect(recentIndexEntries({ a: entry("x", "a.mp3", 1) }, 0)).toEqual([]);
  });

  // 文件被淘汰后索引必须同步清理，否则会指向不存在的音频
  it("drops entries whose files were removed", () => {
    const index: AudioIndex = {
      keep: entry("keep", "keep.mp3", 1),
      drop: entry("drop", "drop.mp3", 2),
    };
    const pruned = pruneIndexEntries(index, ["drop.mp3"]);
    expect(Object.keys(pruned)).toEqual(["keep"]);
  });

  it("keeps everything when nothing was removed", () => {
    const index: AudioIndex = { a: entry("a", "a.mp3", 1) };
    expect(Object.keys(pruneIndexEntries(index, []))).toEqual(["a"]);
  });
});
