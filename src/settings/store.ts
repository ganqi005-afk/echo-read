import { App, normalizePath } from "obsidian";
import {
  PRODUCTION_ITERATIONS,
  decryptString,
  encryptString,
  type SecretBlob,
} from "../store/secrets";

export const SECRETS_DIR = "_lingo";
export const SECRETS_PATH = "_lingo/secrets.json";

export type SecretsFile = Record<string, SecretBlob>;

export async function readSecrets(app: App): Promise<SecretsFile> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(SECRETS_PATH))) return {};
  try {
    return JSON.parse(await adapter.read(SECRETS_PATH)) as SecretsFile;
  } catch {
    return {};
  }
}

export async function writeSecrets(app: App, secrets: SecretsFile): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(SECRETS_DIR))) await adapter.mkdir(SECRETS_DIR);
  await adapter.write(SECRETS_PATH, JSON.stringify(secrets, null, 2));
}

export async function saveSecret(
  app: App,
  name: string,
  value: string,
  passphrase: string,
): Promise<void> {
  const secrets = await readSecrets(app);
  secrets[name] = await encryptString(value, passphrase, PRODUCTION_ITERATIONS);
  await writeSecrets(app, secrets);
}

export async function hasSecret(app: App, name: string): Promise<boolean> {
  return (await readSecrets(app))[name] !== undefined;
}

export async function loadSecret(
  app: App,
  name: string,
  passphrase: string,
): Promise<string> {
  const secrets = await readSecrets(app);
  const blob = secrets[name];
  if (!blob) throw new Error("尚未保存 API Key。");
  return decryptString(blob, passphrase);
}

export async function deleteSecret(app: App, name: string): Promise<void> {
  const secrets = await readSecrets(app);
  delete secrets[name];
  await writeSecrets(app, secrets);
}

export function normalizeSecretPath(): string {
  return normalizePath(SECRETS_PATH);
}
