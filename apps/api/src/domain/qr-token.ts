import type { Env } from "../env";
import { hmacSha256, randomBytes, toBase64Url } from "./token";

/**
 * Participant QR credentials (ADR-003).
 *
 * Two independent secrets, two independent jobs:
 *
 *   QR_PEPPER          HMAC-SHA256 key. Turns the token into a 43-character
 *                      lookup hash. The hash is what the scanner searches on,
 *                      and it is useless without the pepper.
 *   QR_ENCRYPTION_KEY  AES-256-GCM key. Encrypts the token so a reprint can
 *                      recover the exact same credential without ever storing
 *                      plaintext in D1.
 *
 * The token is 32 random bytes (256 bits), far above the 128-bit floor. The QR
 * payload is opaque: `absensi:v1:<token>`, no participant id, no PII. A leaked
 * printout therefore reveals nothing except the credential itself, which can be
 * revoked by clearing the five `qr_*` columns.
 *
 * Nothing here performs I/O, so the whole lifecycle is unit testable and cheap
 * enough for the free-tier CPU budget.
 */

export const QR_PAYLOAD_PREFIX = "absensi:v1:";
export const QR_TOKEN_BYTES = 32; // 256-bit entropy, 43 base64url characters.
export const QR_NONCE_BYTES = 12; // 96-bit GCM nonce, 16 base64url characters.
export const QR_KEY_BYTES = 32; // AES-256.
export const QR_KEY_VERSION_DEFAULT = 1;

/** AAD binds the ciphertext to this purpose; it is not a secret. */
const QR_AAD = new TextEncoder().encode("absensi:qr-token:v1");
const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Configuration or key-version problem. Routes map this to a 500 with a
 * user-readable message; it is never a reason to store a plaintext token.
 */
export class QrConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrConfigError";
  }
}

/** Stored credential shape, exactly the five columns added in `0004_qr.sql`. */
export interface QrCredential {
  tokenHash: string;
  ciphertext: string;
  nonce: string;
  keyVersion: number;
}

export interface StoredQrCredential {
  ciphertext: string | null;
  nonce: string | null;
  keyVersion: number | null;
}

export interface QrKeyConfig {
  pepper: string;
  encryptionKey: CryptoKey;
  keyVersion: number;
}

function base64ToBytes(value: string): Uint8Array {
  // Accept both standard and base64url, and tolerate the trailing newline a
  // `wrangler secret put` value often carries.
  const normalized = value.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

let cachedEncryptionKey: { raw: string; key: Promise<CryptoKey> } | null = null;

function importEncryptionKey(raw: string, bytes: Uint8Array): Promise<CryptoKey> {
  if (cachedEncryptionKey?.raw === raw) return cachedEncryptionKey.key;

  const key = crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);

  cachedEncryptionKey = { raw, key };
  return key;
}

export function parseQrKeyVersion(raw: string | undefined): number {
  const value = (raw ?? "").trim();
  if (value === "") return QR_KEY_VERSION_DEFAULT;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new QrConfigError("QR_KEY_VERSION harus bilangan bulat minimal 1");
  }

  return parsed;
}

/**
 * Resolves and validates the QR secrets. Throws instead of falling back to any
 * weaker mode: a missing key must break printing, not silently store plaintext.
 */
export async function qrKeyConfig(env: Env): Promise<QrKeyConfig> {
  const pepper = (env.QR_PEPPER ?? "").trim();
  if (pepper.length < 16) {
    throw new QrConfigError("QR_PEPPER belum diatur dengan benar");
  }

  const rawKey = (env.QR_ENCRYPTION_KEY ?? "").trim();
  if (rawKey === "") {
    throw new QrConfigError("QR_ENCRYPTION_KEY belum diatur");
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(rawKey);
  } catch {
    throw new QrConfigError("QR_ENCRYPTION_KEY bukan base64 yang valid");
  }

  if (bytes.length !== QR_KEY_BYTES) {
    throw new QrConfigError("QR_ENCRYPTION_KEY harus 32 byte (AES-256)");
  }

  return {
    pepper,
    encryptionKey: await importEncryptionKey(rawKey, bytes),
    keyVersion: parseQrKeyVersion(env.QR_KEY_VERSION),
  };
}

export function generateQrToken(): string {
  return toBase64Url(randomBytes(QR_TOKEN_BYTES));
}

export function isQrToken(value: string): boolean {
  return QR_TOKEN_PATTERN.test(value);
}

export function encodeQrPayload(token: string): string {
  return `${QR_PAYLOAD_PREFIX}${token}`;
}

/** Returns the token from a scan payload, or `null` for anything malformed. */
export function parseQrPayload(payload: string): string | null {
  if (!payload.startsWith(QR_PAYLOAD_PREFIX)) return null;

  const token = payload.slice(QR_PAYLOAD_PREFIX.length);
  return isQrToken(token) ? token : null;
}

export function hashQrToken(pepper: string, token: string): Promise<string> {
  return hmacSha256(pepper, token);
}

async function encryptToken(
  config: QrKeyConfig,
  token: string,
  nonce: Uint8Array,
): Promise<string> {
  const plaintext = new TextEncoder().encode(token);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: QR_AAD },
    config.encryptionKey,
    plaintext,
  );

  return toBase64Url(new Uint8Array(ciphertext));
}

/**
 * Issues a new credential: random token, HMAC hash, fresh nonce, AES-GCM
 * ciphertext. Callers must write all five values together or not at all.
 */
export async function issueQrCredential(
  config: QrKeyConfig,
): Promise<{ token: string; credential: QrCredential }> {
  const token = generateQrToken();
  const nonce = randomBytes(QR_NONCE_BYTES);

  return {
    token,
    credential: {
      tokenHash: await hashQrToken(config.pepper, token),
      ciphertext: await encryptToken(config, token, nonce),
      nonce: toBase64Url(nonce),
      keyVersion: config.keyVersion,
    },
  };
}

/**
 * Recovers the token for printing. A key-version mismatch is a hard error: the
 * old key is gone, and pretending otherwise would either lose the credential or
 * (worse) tempt a plaintext fallback.
 */
export async function readQrCredentialToken(
  config: QrKeyConfig,
  stored: StoredQrCredential,
): Promise<string> {
  if (stored.ciphertext === null || stored.nonce === null || stored.keyVersion === null) {
    throw new QrConfigError("Kredensial QR peserta tidak lengkap");
  }

  if (stored.keyVersion !== config.keyVersion) {
    throw new QrConfigError(
      `Kredensial QR memakai kunci versi ${stored.keyVersion}, kunci aktif versi ${config.keyVersion}`,
    );
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(stored.nonce),
        additionalData: QR_AAD,
      },
      config.encryptionKey,
      base64ToBytes(stored.ciphertext),
    );
  } catch {
    throw new QrConfigError("Kredensial QR tidak dapat didekripsi");
  }

  const token = new TextDecoder().decode(plaintext);
  if (!isQrToken(token)) {
    throw new QrConfigError("Kredensial QR tidak berisi token yang valid");
  }

  return token;
}

/**
 * Rotation primitive: decrypt with the old key and re-encrypt with the new one,
 * keeping the token (and therefore the HMAC hash and every printed QR) intact.
 * The data migration that calls this must also update `qr_key_version`.
 */
export async function reencryptQrCredential(
  from: QrKeyConfig,
  to: QrKeyConfig,
  stored: StoredQrCredential,
): Promise<{ ciphertext: string; nonce: string; keyVersion: number }> {
  const token = await readQrCredentialToken(from, stored);
  const nonce = randomBytes(QR_NONCE_BYTES);

  return {
    ciphertext: await encryptToken(to, token, nonce),
    nonce: toBase64Url(nonce),
    keyVersion: to.keyVersion,
  };
}
