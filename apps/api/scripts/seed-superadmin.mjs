#!/usr/bin/env node
/**
 * Creates a one-time superadmin invite and prints the activation URL.
 *
 * The bootstrap problem: the first account cannot be invited by an admin,
 * because there is no admin yet. This script solves it without inventing a
 * default password — it writes a normal invite row (single use, expiring) and
 * prints the URL. Nothing secret is stored in plaintext; only the HMAC.
 *
 * Usage:
 *   npm run seed:superadmin                     # local D1
 *   npm run seed:superadmin -- --expires-hours 24
 *   npm run seed:superadmin -- --remote --yes   # requires SESSION_PEPPER
 *
 * Remote runs need `SESSION_PEPPER` from the production environment: the hash
 * must be computed with the same pepper the deployed Worker uses. The script
 * refuses to guess it, because a hash with the wrong pepper is a silent
 * "token tidak valid" later.
 */
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

/** ULID-shaped: 48-bit time + 80 random bits, no dependency. */
function newId(now) {
  let time = "";
  let remaining = now;

  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }

  const bytes = randomBytes(16);
  let random = "";
  for (const byte of bytes) random += ALPHABET[byte % 32];

  return time + random;
}

function readDevVars() {
  try {
    const contents = readFileSync(join(API_ROOT, ".dev.vars"), "utf8");
    const values = {};

    for (const line of contents.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }

    return values;
  } catch {
    return {};
  }
}

const remote = hasFlag("--remote");
const confirmed = hasFlag("--yes");
const expiresHours = Number(readFlag("--expires-hours") ?? 72);
const database = readFlag("--db") ?? "absensi-db";
const baseUrl = (readFlag("--base-url") ?? "http://localhost:5173").replace(/\/+$/, "");

if (!Number.isFinite(expiresHours) || expiresHours < 1 || expiresHours > 168) {
  fail("--expires-hours harus antara 1 dan 168");
}

if (remote && !confirmed) {
  fail("Menulis ke D1 remote butuh konfirmasi eksplisit: tambahkan --yes");
}

const pepper = process.env.SESSION_PEPPER ?? readDevVars().SESSION_PEPPER;

if (!pepper) {
  fail(
    remote
      ? "SESSION_PEPPER tidak diset. Ekspor secret produksi dulu: export SESSION_PEPPER=..."
      : "SESSION_PEPPER tidak ada di apps/api/.dev.vars",
  );
}

if (remote) {
  console.warn(
    "⚠ Mode remote: pastikan SESSION_PEPPER berasal dari `wrangler secret`, bukan nilai dev.",
  );
}

const token = randomBytes(16).toString("base64url"); // 128 bits (ADR-002)
const tokenHash = createHmac("sha256", pepper).update(token).digest("base64url");
const now = Date.now();
const expiresAt = now + expiresHours * 60 * 60 * 1000;

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const sql = [
  "INSERT INTO invites (id, event_id, role, token_hash, invited_name, created_by, created_at, expires_at)",
  `VALUES (${sqlString(newId(now))}, NULL, 'superadmin', ${sqlString(tokenHash)}, 'Superadmin', NULL, ${now}, ${expiresAt});`,
  "",
].join("\n");

const directory = mkdtempSync(join(tmpdir(), "absensi-seed-"));
const sqlPath = join(directory, "superadmin-invite.sql");
writeFileSync(sqlPath, sql, "utf8");

const target = remote ? "--remote" : "--local";
const result = spawnSync(
  "wrangler",
  ["d1", "execute", database, target, `--file=${sqlPath}`, "--yes"],
  { cwd: API_ROOT, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.status !== 0) {
  fail(`wrangler d1 execute gagal (exit ${result.status ?? "unknown"})`);
}

console.log("");
console.log("✔ Undangan superadmin dibuat.");
console.log("");
console.log(`  URL aktivasi : ${baseUrl}/aktivasi#t=${token}`);
console.log(`  Berlaku sampai: ${new Date(expiresAt).toISOString()}`);
console.log("");
console.log("  Token hanya ditampilkan sekali dan hanya hash-nya yang tersimpan.");
console.log("  Buka URL di browser, lalu simpan kode pemulihan yang muncul.");
