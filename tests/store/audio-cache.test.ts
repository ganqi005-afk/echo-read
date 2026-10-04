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
  // 缓存键 = 音色签名 + 文本。签名内部包含模型/音色/格式/语速等，
  // 那些维度的独立性由 tts-request.test.ts 的 voiceSignature 测试覆盖。
  it("is stable for identical inputs", () => {
    expect(buildCacheKey("sig", "Hello.")).toBe(buildCacheKey("sig", "Hello."));
  });

  it("changes when the text changes", () => {
    expect(buildCacheKey("sig", "Bye.")).not.toBe(buildCacheKey("sig", "Hello."));
  });

  it("changes when the voice signature changes", () => {
    expect(buildCacheKey("sig2", "Hello.")).not.toBe(buildCacheKey("sig", "Hello."));
  });

  // 用 \u0000 作分隔符：普通文本里不会出现它，因此不会把两个字段拼出歧义
  it("uses a separator that cannot appear in normal text", () => {
    expect(buildCacheKey("a", "b")).toBe(`a\u0000b`);
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
