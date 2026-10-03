export interface SecretBlob {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export const PRODUCTION_ITERATIONS = 600_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptString(
  plaintext: string,
  passphrase: string,
  iterations: number = PRODUCTION_ITERATIONS,
): Promise<SecretBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    encoder.encode(plaintext),
  );
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct)),
  };
}

export async function decryptString(blob: SecretBlob, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(blob.salt), blob.iter);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(blob.iv) as BufferSource },
    key,
    fromBase64(blob.ct) as BufferSource,
  );
  return decoder.decode(plain);
}
