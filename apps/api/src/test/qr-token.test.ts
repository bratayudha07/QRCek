import { describe, expect, it } from "vitest";

import {
  QrConfigError,
  encodeQrPayload,
  generateQrToken,
  hashQrToken,
  isQrToken,
  issueQrCredential,
  parseQrKeyVersion,
  parseQrPayload,
  qrKeyConfig,
  readQrCredentialToken,
  reencryptQrCredential,
} from "../domain/qr-token";
import type { QrKeyConfig } from "../domain/qr-token";
import { toBase64Url } from "../domain/token";
import { testEnv } from "./env";

/**
 * Domain tests for the QR credential lifecycle (AGENTS.md: pure logic needs
 * unit tests without I/O). The real D1 binding is irrelevant here; only Web
 * Crypto and the test secrets are used.
 */

const OTHER_KEY = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY="; // 32 bytes.

function envWith(overrides: Record<string, string>): typeof testEnv {
  return { ...testEnv, ...overrides } as typeof testEnv;
}

async function keyConfig(): Promise<QrKeyConfig> {
  return qrKeyConfig(testEnv);
}

describe("QR token format", () => {
  it("generates a 43-character base64url token with 256 bits of entropy", () => {
    const token = generateQrToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isQrToken(token)).toBe(true);

    const binary = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    expect(binary).toHaveLength(32);
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateQrToken()));
    expect(tokens.size).toBe(200);
  });

  it("round-trips the opaque scan payload", () => {
    const token = generateQrToken();
    const payload = encodeQrPayload(token);

    expect(payload).toBe(`absensi:v1:${token}`);
    expect(parseQrPayload(payload)).toBe(token);
  });

  it("rejects malformed or foreign payloads", () => {
    const token = generateQrToken();

    for (const payload of [
      "",
      token,
      `absensi:v2:${token}`,
      `absensi:v1:${token.slice(0, 42)}`,
      `absensi:v1:${token}extra`,
      "absensi:v1:../../../etc/passwd",
    ]) {
      expect(parseQrPayload(payload)).toBeNull();
    }
  });

  it("carries no participant data or PII", () => {
    const token = generateQrToken();
    const payload = encodeQrPayload(token);

    expect(payload).not.toMatch(/@/);
    expect(payload).not.toMatch(/\d{10,}/);
    expect(payload).toBe(`absensi:v1:${token}`);
  });
});

describe("QR hashing", () => {
  it("is deterministic and pepper-dependent", async () => {
    const token = generateQrToken();

    const a = await hashQrToken(testEnv.QR_PEPPER, token);
    const b = await hashQrToken(testEnv.QR_PEPPER, token);
    const c = await hashQrToken(`${testEnv.QR_PEPPER}-other`, token);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(43);
  });

  it("produces a different hash for a different token", async () => {
    const first = await hashQrToken(testEnv.QR_PEPPER, generateQrToken());
    const second = await hashQrToken(testEnv.QR_PEPPER, generateQrToken());

    expect(first).not.toBe(second);
  });
});

describe("QR encryption", () => {
  it("issues a complete credential and decrypts back to the token", async () => {
    const config = await keyConfig();
    const { token, credential } = await issueQrCredential(config);

    expect(credential.tokenHash).toHaveLength(43);
    expect(credential.ciphertext).toHaveLength(79); // 43-byte token + 16-byte GCM tag.
    expect(credential.nonce).toHaveLength(16);
    expect(credential.keyVersion).toBe(1);

    const decrypted = await readQrCredentialToken(config, credential);
    expect(decrypted).toBe(token);
    expect(await hashQrToken(config.pepper, decrypted)).toBe(credential.tokenHash);
  });

  it("uses a unique nonce and ciphertext for every issuance", async () => {
    const config = await keyConfig();
    const a = await issueQrCredential(config);
    const b = await issueQrCredential(config);

    expect(a.credential.nonce).not.toBe(b.credential.nonce);
    expect(a.credential.ciphertext).not.toBe(b.credential.ciphertext);
  });

  it("rejects tampered ciphertext instead of returning garbage", async () => {
    const config = await keyConfig();
    const { credential } = await issueQrCredential(config);

    const tampered = {
      ...credential,
      ciphertext: `${credential.ciphertext.slice(0, -2)}AA`,
    };

    await expect(readQrCredentialToken(config, tampered)).rejects.toBeInstanceOf(QrConfigError);
  });

  it("rejects a token encrypted with a different key", async () => {
    const config = await keyConfig();
    const other = await qrKeyConfig(envWith({ QR_ENCRYPTION_KEY: OTHER_KEY }));
    const { credential } = await issueQrCredential(config);

    await expect(readQrCredentialToken(other, credential)).rejects.toBeInstanceOf(QrConfigError);
  });

  it("fails loudly on an unknown key version", async () => {
    const config = await keyConfig();
    const rotated = await qrKeyConfig(envWith({ QR_KEY_VERSION: "2" }));
    const { credential } = await issueQrCredential(config);

    await expect(readQrCredentialToken(rotated, credential)).rejects.toThrow(/versi 1.*versi 2/);
  });

  it("re-encrypts for rotation without changing token or hash", async () => {
    const oldConfig = await keyConfig();
    const newConfig = await qrKeyConfig(envWith({ QR_ENCRYPTION_KEY: OTHER_KEY, QR_KEY_VERSION: "2" }));
    const { token, credential } = await issueQrCredential(oldConfig);

    const rotated = await reencryptQrCredential(oldConfig, newConfig, credential);

    expect(rotated.keyVersion).toBe(2);
    expect(rotated.ciphertext).not.toBe(credential.ciphertext);
    expect(await readQrCredentialToken(newConfig, rotated)).toBe(token);
    // The printed QR and the scan lookup keep working because the token is the
    // same; only the encrypted copy changed.
    expect(await hashQrToken(oldConfig.pepper, token)).toBe(credential.tokenHash);
  });

  it("rejects an incomplete stored credential", async () => {
    const config = await keyConfig();

    await expect(
      readQrCredentialToken(config, { ciphertext: null, nonce: null, keyVersion: null }),
    ).rejects.toBeInstanceOf(QrConfigError);
  });
});

describe("QR secret configuration", () => {
  it("accepts a 32-byte base64 key and defaults the version to 1", async () => {
    const config = await qrKeyConfig(envWith({ QR_KEY_VERSION: "" }));
    expect(config.keyVersion).toBe(1);
  });

  it("rejects a missing pepper", async () => {
    await expect(qrKeyConfig(envWith({ QR_PEPPER: "" }))).rejects.toBeInstanceOf(QrConfigError);
  });

  it("rejects a missing or malformed encryption key", async () => {
    await expect(
      qrKeyConfig(envWith({ QR_ENCRYPTION_KEY: "" })),
    ).rejects.toBeInstanceOf(QrConfigError);

    await expect(
      qrKeyConfig(envWith({ QR_ENCRYPTION_KEY: "not-base64!!" })),
    ).rejects.toBeInstanceOf(QrConfigError);

    await expect(
      qrKeyConfig(envWith({ QR_ENCRYPTION_KEY: toBase64Url(new Uint8Array(16)) })),
    ).rejects.toBeInstanceOf(QrConfigError);
  });

  it("rejects an invalid key version", () => {
    expect(() => parseQrKeyVersion("0")).toThrow(QrConfigError);
    expect(() => parseQrKeyVersion("-1")).toThrow(QrConfigError);
    expect(() => parseQrKeyVersion("1.5")).toThrow(QrConfigError);
    expect(() => parseQrKeyVersion("abc")).toThrow(QrConfigError);
  });
});
