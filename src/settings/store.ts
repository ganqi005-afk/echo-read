import { App, normalizePath } from "obsidian";
import {
  PRODUCTION_ITERATIONS,
  decryptString,
  encryptString,
  type SecretBlob,
} from "../store/secrets";
import { classifyApiKey, type ApiKeyKind } from "./key-format";

export const SECRETS_DIR = "_lingo";
export const SECRETS_PATH = "_lingo/secrets.json";

/** 一把具名 Key。label 与 kind 是明文元数据（不含密钥内容），便于解锁前就能列出。 */
export interface KeyRecord {
  label: string;
  kind: ApiKeyKind;
  blob: SecretBlob;
}

export interface SecretsFile {
  keys?: Record<string, KeyRecord>;
  /** 旧格式：只有一把 Key。读取时自动迁移，不丢数据。 */
  bailianApiKey?: SecretBlob;
}

export interface KeySummary {
  id: string;
  label: string;
  kind: ApiKeyKind;
}

/**
 * 把旧格式（单把 bailianApiKey）迁移成新的具名 Key 列表。
 * 密钥本身是密文，迁移只是结构调整，不需要口令。
 */
export function migrateSecrets(file: SecretsFile): SecretsFile {
  if (file.keys && Object.keys(file.keys).length > 0) return file;
  if (!file.bailianApiKey) return { keys: {} };
  return {
    keys: {
      legacy: {
        label: "原默认 Key",
        kind: classifyApiKey("sk-"),
        blob: file.bailianApiKey,
      },
    },
  };
}

export function listKeySummaries(file: SecretsFile): KeySummary[] {
  const keys = file.keys ?? {};
  return Object.entries(keys)
    .map(([id, record]) => ({ id, label: record.label, kind: record.kind }))
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

export async function readSecrets(app: App): Promise<SecretsFile> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(SECRETS_PATH))) return { keys: {} };
  try {
    const parsed = JSON.parse(await adapter.read(SECRETS_PATH)) as SecretsFile;
    const migrated = migrateSecrets(parsed);
    if (!parsed.keys) await writeSecrets(app, migrated);
    return migrated;
  } catch {
    return { keys: {} };
  }
}

export async function writeSecrets(app: App, secrets: SecretsFile): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(SECRETS_DIR))) await adapter.mkdir(SECRETS_DIR);
  await adapter.write(SECRETS_PATH, JSON.stringify(secrets, null, 2));
}

export async function listKeys(app: App): Promise<KeySummary[]> {
  return listKeySummaries(await readSecrets(app));
}

export async function saveKey(
  app: App,
  id: string,
  label: string,
  apiKey: string,
  passphrase: string,
): Promise<void> {
  const secrets = await readSecrets(app);
  secrets.keys = secrets.keys ?? {};
  secrets.keys[id] = {
    label,
    kind: classifyApiKey(apiKey),
    blob: await encryptString(apiKey, passphrase, PRODUCTION_ITERATIONS),
  };
  await writeSecrets(app, secrets);
}

export async function deleteKey(app: App, id: string): Promise<void> {
  const secrets = await readSecrets(app);
  if (secrets.keys) delete secrets.keys[id];
  await writeSecrets(app, secrets);
}

/**
 * 用同一个口令解锁全部 Key。任一把解不开就抛出 ——
 * 口令是全局的，失败意味着口令不对，而不是某把 Key 损坏。
 */
export async function unlockAllKeys(
  app: App,
  passphrase: string,
): Promise<Record<string, string>> {
  const secrets = await readSecrets(app);
  const unlocked: Record<string, string> = {};
  for (const [id, record] of Object.entries(secrets.keys ?? {})) {
    unlocked[id] = await decryptString(record.blob, passphrase);
  }
  return unlocked;
}

export function normalizeSecretPath(): string {
  return normalizePath(SECRETS_PATH);
}
