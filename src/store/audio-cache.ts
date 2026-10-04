import { App, DataAdapter } from "obsidian";

// 音频索引放在插件自己的数据目录 —— 它是元数据，不是素材。
// 素材跟随用户的附件设置，元数据跟随插件，两者的归属不同。
export const AUDIO_INDEX_PATH = "_lingo/audio-index.json";

// 附件目录下用这个子目录收拢，避免和真正的图片、PDF 混在一起
export const AUDIO_SUBFOLDER = "echo-read";

// 迁移前的旧位置
export const LEGACY_AUDIO_DIR = "_lingo/audio";

function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part !== "")
    .join("/")
    .replace(/\/{2,}/g, "/");
}

async function ensureDir(adapter: DataAdapter, dir: string): Promise<void> {
  if (dir === "" || (await adapter.exists(dir))) return;
  const segments = dir.split("/");
  let current = "";
  for (const segment of segments) {
    current = current === "" ? segment : `${current}/${segment}`;
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

// 解析音频该存到哪 —— 跟随 Obsidian 自己的附件目录设置。
//
// 这样生成的音频就是一个普通的 vault 附件：能在文件浏览器里看到、
// 能随笔记一起管理，而不是藏在插件目录里的一堆哈希文件。
//
// attachmentFolderPath 有四种取值：
// - "" 或 "/" → 仓库根目录
// - folder → 固定目录
// - "./" → 与当前笔记同目录
// - "./sub" → 当前笔记目录下的 sub
//
// 后两种是相对当前笔记的，因此跨笔记去重会失效（同一句话在两篇笔记里各存一份、
// 各付一次费）。这是跟随用户设置的代价，设置页会写出来。
export function resolveAudioRoot(attachmentFolderPath: string, notePath: string): string {
  const raw = (attachmentFolderPath ?? "").trim();
  const noteDir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";

  if (raw === "" || raw === "/") return AUDIO_SUBFOLDER;
  if (raw === "./") return joinPath(noteDir, AUDIO_SUBFOLDER);
  if (raw.startsWith("./")) return joinPath(noteDir, raw.slice(2), AUDIO_SUBFOLDER);
  return joinPath(raw.replace(/^\/+|\/+$/g, ""), AUDIO_SUBFOLDER);
}

/** 按当前笔记与 Obsidian 的附件设置，算出音频该存到哪。 */
export function currentAudioRoot(app: App): string {
  // getConfig 是 Obsidian 未公开的 API，类型定义里没有，取不到就退回默认值
  const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
  let attachmentFolder = "";
  try {
    const configured = vault.getConfig?.("attachmentFolderPath");
    if (typeof configured === "string") attachmentFolder = configured;
  } catch {
    attachmentFolder = "";
  }
  const notePath = app.workspace.getActiveFile()?.path ?? "";
  return resolveAudioRoot(attachmentFolder, notePath);
}

export function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// 缓存键 = 音色签名 + 文本。
//
// 音色签名内部包含模型、音色、格式、语速、音量、音调、指令、语种 ——
// 换任何一项都必须换缓存键，否则会命中旧音频，出现"换了设置但声音没变"。
export function buildCacheKey(signature: string, text: string): string {
  return [signature, text].join("\u0000");
}

export async function hashCacheKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return toHex(digest).slice(0, 32);
}

export async function audioCachePath(
  root: string,
  signature: string,
  text: string,
  format: string,
): Promise<string> {
  const hash = await hashCacheKey(buildCacheKey(signature, text));
  return joinPath(root, `${hash}.${format}`);
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
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  await ensureDir(adapter, dir);
  await adapter.writeBinary(path, bytes);
}

// 把合成回来的音频写进缓存，并登记索引。
//
// 这是"减少消耗"的落点：写完之后，同一段文字再朗读就直接播本地文件，
// 不再发起任何合成请求。
export async function cacheSynthesizedAudio(
  app: App,
  root: string,
  signature: string,
  parts: { text: string; format: string; voice: string; model: string },
  bytes: ArrayBuffer,
): Promise<string> {
  const hash = await hashCacheKey(buildCacheKey(signature, parts.text));
  const file = joinPath(root, `${hash}.${parts.format}`);

  await writeCachedAudio(app, file, bytes);

  const index = await readAudioIndex(app);
  await writeAudioIndex(
    app,
    upsertIndexEntry(index, hash, { ...parts, file, createdAt: Date.now() }),
  );

  return file;
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

// 决定该淘汰哪些缓存文件。
//
// 写成纯函数是为了让规则可测：先按天数淘汰，再按体积从最旧的删。
// 这种规则如果埋在文件循环里，很容易写出"删错文件却看不出来"的代码 ——
// 而缓存删错意味着用户要重新付费生成，属于真实损失。
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

export async function listAudioCache(app: App, root: string): Promise<CacheEntry[]> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(root))) return [];

  let files: string[] = [];
  try {
    files = (await adapter.list(root)).files;
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

// 只取缓存文件的路径集合，用于"这句有没有缓存"的快速判断。
//
// 直接看文件而不是索引：文件名就是内容哈希，所以连旧版本的缓存也算得进来。
export async function listAudioFilePaths(app: App, root: string): Promise<Set<string>> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(root))) return new Set();
  try {
    const files = (await adapter.list(root)).files;
    // 索引文件不是音频，别把它算进缓存命中
    return new Set(files.filter((file) => !file.endsWith(".json")));
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

export async function clearAudioCache(app: App, root: string): Promise<number> {
  const removed = await removeCacheEntries(app, await listAudioCache(app, root));
  await writeAudioIndex(app, {});
  return removed;
}

export async function pruneAudioCache(
  app: App,
  root: string,
  options: { maxAgeDays: number; maxBytes: number },
): Promise<number> {
  const entries = await listAudioCache(app, root);
  const doomed = selectForRemoval(entries, { ...options, now: Date.now() });
  const removed = await removeCacheEntries(app, doomed);

  // 索引必须同步清理，否则会留下指向不存在音频的条目
  if (doomed.length > 0) {
    const index = await readAudioIndex(app);
    await writeAudioIndex(app, pruneIndexEntries(index, doomed.map((entry) => entry.path)));
  }

  return removed;
}

// 把旧位置（_lingo/audio）的音频搬到新位置。
//
// 这一步是必须的：文件名就是内容哈希，所以搬过去之后缓存依然命中。
// 不搬的话，用户已经付过费的合成结果会全部变成孤儿 —— 那是真实损失。
export async function migrateAudioCache(
  app: App,
  targetRoot: string,
): Promise<number> {
  if (targetRoot === LEGACY_AUDIO_DIR) return 0;
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(LEGACY_AUDIO_DIR))) return 0;

  let files: string[] = [];
  try {
    files = (await adapter.list(LEGACY_AUDIO_DIR)).files;
  } catch {
    return 0;
  }

  await ensureDir(adapter, targetRoot);
  let moved = 0;
  for (const file of files) {
    if (file.endsWith(".json")) continue;
    const name = file.slice(file.lastIndexOf("/") + 1);
    const destination = joinPath(targetRoot, name);
    try {
      if (await adapter.exists(destination)) continue;
      await adapter.rename(file, destination);
      moved++;
    } catch {
      // 单个文件搬不动就跳过，不阻断其它文件
    }
  }
  return moved;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------- 音频索引 ----------------

// 一条索引记录。文件名是内容哈希，人看不懂 ——
// 所以额外记下原文，让缓存变成"可核对"的东西：
// 你能看到到底缓存了哪些句子，而不是只有一个数字。
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
  await ensureDir(adapter, "_lingo");
  await adapter.write(AUDIO_INDEX_PATH, JSON.stringify(index, null, 2));
}
