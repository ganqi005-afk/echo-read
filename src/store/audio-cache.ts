import { App } from "obsidian";

/**
 * 示范音缓存。设计文档 12.3 定下的规则：
 * 缓存键必须包含 文本 + 音色 + 模型 + 格式 —— 少任何一项，
 * 换了音色或模型后都会命中旧音频，出现"换了设置但声音没变"的怪问题。
 */
export const AUDIO_CACHE_DIR = "_lingo/audio";

export function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildCacheKey(signature: string, text: string): string {
  return [signature, text].join("\u0000");
}

export async function hashCacheKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return toHex(digest).slice(0, 32);
}

export async function audioCachePath(
  signature: string,
  text: string,
  format: string,
): Promise<string> {
  const hash = await hashCacheKey(buildCacheKey(signature, text));
  return `${AUDIO_CACHE_DIR}/${hash}.${format}`;
}

export async function readCachedAudio(
  app: App,
  path: string,
): Promise<ArrayBuffer | undefined> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(path))) return undefined;
  try {
    return await adapter.readBinary(path);
  } catch {
    return undefined;
  }
}

export async function writeCachedAudio(
  app: App,
  path: string,
  bytes: ArrayBuffer,
): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(AUDIO_CACHE_DIR))) await adapter.mkdir(AUDIO_CACHE_DIR);
  await adapter.writeBinary(path, bytes);
}

export interface CacheEntry {
  path: string;
  size: number;
  /** 毫秒时间戳。 */
  mtime: number;
}

export interface CacheStats {
  count: number;
  bytes: number;
}

export function summarizeCache(entries: CacheEntry[]): CacheStats {
  return {
    count: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.size, 0),
  };
}

/**
 * 决定该淘汰哪些缓存文件。
 *
 * 写成纯函数是为了让规则可测：先按天数淘汰，再按体积从最旧的删。
 * 这种规则如果埋在文件循环里，很容易写出"删错文件却看不出来"的代码 ——
 * 而缓存删错意味着用户要重新付费生成，属于真实损失。
 */
export function selectForRemoval(
  entries: CacheEntry[],
  options: { maxAgeDays: number; maxBytes: number; now: number },
): CacheEntry[] {
  const doomed = new Set<string>();
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (options.maxAgeDays > 0) {
    const cutoff = options.now - options.maxAgeDays * DAY_MS;
    for (const entry of entries) {
      if (entry.mtime < cutoff) doomed.add(entry.path);
    }
  }

  const survivors = entries.filter((entry) => !doomed.has(entry.path));
  let total = survivors.reduce((sum, entry) => sum + entry.size, 0);

  if (options.maxBytes > 0 && total > options.maxBytes) {
    // 从最旧的开始删，直到降到上限以内 —— 最近用过的句子最该留下
    for (const entry of [...survivors].sort((a, b) => a.mtime - b.mtime)) {
      if (total <= options.maxBytes) break;
      doomed.add(entry.path);
      total -= entry.size;
    }
  }

  return entries.filter((entry) => doomed.has(entry.path));
}

export async function listAudioCache(app: App): Promise<CacheEntry[]> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(AUDIO_CACHE_DIR))) return [];

  let files: string[] = [];
  try {
    files = (await adapter.list(AUDIO_CACHE_DIR)).files;
  } catch {
    return [];
  }

  const entries: CacheEntry[] = [];
  for (const file of files) {
    try {
      const stat = await adapter.stat(file);
      if (stat) entries.push({ path: file, size: stat.size, mtime: stat.mtime });
    } catch {
      // 文件可能刚好被同步或清理掉，跳过即可
    }
  }
  return entries;
}

/**
 * 只取缓存文件的路径集合，用于"这句有没有缓存"的快速判断。
 *
 * 直接看文件而不是索引：文件名就是内容哈希，所以连旧版本的缓存也算得进来；
 * 索引里的 signature 是后来才加的字段，靠它反而会漏掉历史记录。
 */
export async function listAudioFilePaths(app: App): Promise<Set<string>> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(AUDIO_CACHE_DIR))) return new Set();
  try {
    return new Set((await adapter.list(AUDIO_CACHE_DIR)).files);
  } catch {
    return new Set();
  }
}

export async function removeCacheEntries(app: App, entries: CacheEntry[]): Promise<number> {
  const adapter = app.vault.adapter;
  let removed = 0;
  for (const entry of entries) {
    try {
      await adapter.remove(entry.path);
      removed++;
    } catch {
      // 已经不存在，就当删过了
    }
  }
  return removed;
}

export async function clearAudioCache(app: App): Promise<number> {
  const entries = await listAudioCache(app);
  const removed = await removeCacheEntries(app, entries);
  await writeAudioIndex(app, {});
  return removed;
}

export async function pruneAudioCache(
  app: App,
  options: { maxAgeDays: number; maxBytes: number },
): Promise<number> {
  const entries = await listAudioCache(app);
  const doomed = selectForRemoval(entries, { ...options, now: Date.now() });
  const removed = await removeCacheEntries(app, doomed);

  // 索引必须同步清理，否则会留下指向不存在音频的条目
  if (doomed.length > 0) {
    const index = await readAudioIndex(app);
    await writeAudioIndex(app, pruneIndexEntries(index, doomed.map((entry) => entry.path)));
  }

  return removed;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------- 音频索引 ----------------

export const AUDIO_INDEX_PATH = "_lingo/audio/index.json";

/**
 * 一条索引记录。文件名是内容哈希，人看不懂 ——
 * 所以额外记下原文，让缓存变成"可核对"的东西：
 * 你能看到到底缓存了哪些句子，而不是只有一个数字。
 */
export interface AudioIndexEntry {
  text: string;
  voice: string;
  model: string;
  format: string;
  file: string;
  createdAt: number;
}

export type AudioIndex = Record<string, AudioIndexEntry>;

export function upsertIndexEntry(
  index: AudioIndex,
  hash: string,
  entry: AudioIndexEntry,
): AudioIndex {
  return { ...index, [hash]: entry };
}

/** 按创建时间倒序取最近的若干条，用于在设置页里展示。 */
export function recentIndexEntries(index: AudioIndex, limit: number): AudioIndexEntry[] {
  return Object.values(index)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, limit));
}

/** 文件被淘汰后，索引里对应的条目也要清掉，否则会指向不存在的音频。 */
export function pruneIndexEntries(index: AudioIndex, removedFiles: string[]): AudioIndex {
  const gone = new Set(removedFiles);
  const out: AudioIndex = {};
  for (const [hash, entry] of Object.entries(index)) {
    if (!gone.has(entry.file)) out[hash] = entry;
  }
  return out;
}

export async function readAudioIndex(app: App): Promise<AudioIndex> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(AUDIO_INDEX_PATH))) return {};
  try {
    return JSON.parse(await adapter.read(AUDIO_INDEX_PATH)) as AudioIndex;
  } catch {
    return {};
  }
}

export async function writeAudioIndex(app: App, index: AudioIndex): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(AUDIO_CACHE_DIR))) await adapter.mkdir(AUDIO_CACHE_DIR);
  await adapter.write(AUDIO_INDEX_PATH, JSON.stringify(index, null, 2));
}

/**
 * 把合成回来的音频写进本地缓存，并登记索引。
 *
 * 这是"减少消耗"的落点：写完之后，同一段文字再朗读就直接播本地文件，
 * 不再发起任何合成请求。
 */
export async function cacheSynthesizedAudio(
  app: App,
  signature: string,
  parts: { text: string; format: string; voice: string; model: string },
  bytes: ArrayBuffer,
): Promise<string> {
  const hash = await hashCacheKey(buildCacheKey(signature, parts.text));
  const file = `${AUDIO_CACHE_DIR}/${hash}.${parts.format}`;

  await writeCachedAudio(app, file, bytes);

  const index = await readAudioIndex(app);
  await writeAudioIndex(
    app,
    upsertIndexEntry(index, hash, { ...parts, file, createdAt: Date.now() }),
  );

  return file;
}
