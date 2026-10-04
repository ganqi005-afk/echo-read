import { App } from "obsidian";
import { classifyApiKey, type ApiKeyKind } from "./key-format";

export const KEYS_DIR = "_lingo";
export const KEYS_PATH = "_lingo/keys.json";

/**
 * 一把具名 Key，**明文保存**。
 *
 * 设计文档 15.3 原本采用口令派生加密（PBKDF2 + AES-GCM），
 * 后因使用成本被移除 —— 每次使用都要解锁口令，对单人自用不划算。
 * 代价是 Key 会以明文形式随 vault 同步上云，这一点在文档里如实记录。
 */
export interface KeyRecord {
  label: string;
  kind: ApiKeyKind;
  value: string;
}

export interface KeysFile {
  keys?: Record<string, KeyRecord>;
}

export interface KeySummary {
  id: string;
  label: string;
  kind: ApiKeyKind;
  hasValue: boolean;
}

/** 旧的加密格式记录：有 blob 没有 value，无法解密，只能留空等用户重填。 */
interface LegacyRecord {
  label?: string;
  kind?: ApiKeyKind;
  /** 旧版加密方案留下的密文。读到时说明该记录需要重新填写。 */
  blob?: unknown;
  value?: unknown;
}

/**
 * 把旧的加密记录迁移成明文记录。
 * 密文无法在没有口令的情况下还原，因此 value 留空 ——
 * 但**保留标签**，用户至少知道需要重填哪几把，而不是一片空白。
 */
export function migrateKeys(
  file: { keys?: Record<string, LegacyRecord> },
): KeysFile {
  const out: Record<string, KeyRecord> = {};
  for (const [id, record] of Object.entries(file.keys ?? {})) {
    out[id] = {
      label: record.label ?? id,
      kind: record.kind ?? "unknown",
      value: typeof record.value === "string" ? record.value : "",
    };
  }
  return { keys: out };
}

export function listKeySummaries(file: KeysFile): KeySummary[] {
  return Object.entries(file.keys ?? {})
    .map(([id, record]) => ({
      id,
      label: record.label,
      kind: record.kind,
      hasValue: record.value.trim() !== "",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function makeKeyId(existing: string[], label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug === "" ? "key" : slug;
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

export async function readKeys(app: App): Promise<KeysFile> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(KEYS_PATH))) return { keys: {} };
  try {
    const parsed = JSON.parse(await adapter.read(KEYS_PATH)) as {
      keys?: Record<string, LegacyRecord>;
    };
    return migrateKeys(parsed);
  } catch {
    return { keys: {} };
  }
}

export async function writeKeys(app: App, file: KeysFile): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(KEYS_DIR))) await adapter.mkdir(KEYS_DIR);
  await adapter.write(KEYS_PATH, JSON.stringify(file, null, 2));
}

export async function listKeys(app: App): Promise<KeySummary[]> {
  return listKeySummaries(await readKeys(app));
}

export async function saveKey(
  app: App,
  id: string,
  label: string,
  apiKey: string,
): Promise<void> {
  const file = await readKeys(app);
  file.keys = file.keys ?? {};
  file.keys[id] = { label, kind: classifyApiKey(apiKey), value: apiKey };
  await writeKeys(app, file);
}

export async function deleteKey(app: App, id: string): Promise<void> {
  const file = await readKeys(app);
  if (file.keys) delete file.keys[id];
  await writeKeys(app, file);
}

/** 读出全部 Key 的明文值，供各能力直接使用。 */
export async function loadKeyValues(app: App): Promise<Record<string, string>> {
  const file = await readKeys(app);
  const values: Record<string, string> = {};
  for (const [id, record] of Object.entries(file.keys ?? {})) {
    if (record.value.trim() !== "") values[id] = record.value;
  }
  return values;
}
