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

export function buildCacheKey(parts: {
  text: string;
  voice: string;
  model: string;
  format: string;
}): string {
  return [parts.model, parts.voice, parts.format, parts.text].join("\u0000");
}

export async function hashCacheKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return toHex(digest).slice(0, 32);
}

export async function audioCachePath(
  text: string,
  voice: string,
  model: string,
  format: string,
): Promise<string> {
  const hash = await hashCacheKey(buildCacheKey({ text, voice, model, format }));
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
