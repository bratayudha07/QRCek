import type { EventRole, Role } from "@absensi/shared";

import { newId } from "../domain/ids";
import { hmacSha256, randomToken } from "../domain/token";
import { testEnv } from "./env";
import { DAY_MS, callApi, TEST_NOW } from "./http";

/**
 * Direct D1 fixtures.
 *
 * Rows are inserted with SQL rather than through endpoints so each test can
 * start from an exact state (a specific role, an already-expired row, a revoked
 * session) without depending on unrelated routes.
 */

export const PEPPER = testEnv.SESSION_PEPPER;

export async function createUser(
  options: {
    id?: string;
    role?: Role;
    displayName?: string;
    status?: "active" | "suspended";
  } = {},
): Promise<string> {
  const id = options.id ?? newId(TEST_NOW);

  await testEnv.DB.prepare(
    `INSERT INTO users (id, display_name, role, status, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      options.displayName ?? "Pengguna Uji",
      options.role ?? "officer",
      options.status ?? "active",
      TEST_NOW,
    )
    .run();

  return id;
}

export async function createEvent(
  options: { id?: string; name?: string; createdBy: string },
): Promise<string> {
  const id = options.id ?? newId(TEST_NOW);

  await testEnv.DB.prepare(
    `INSERT INTO events (id, slug, name, created_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, `uji-${id.toLowerCase().slice(-10)}`, options.name ?? "Acara Uji", TEST_NOW, options.createdBy)
    .run();

  return id;
}

export async function addMembership(
  eventId: string,
  userId: string,
  role: EventRole,
): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO event_memberships (id, event_id, user_id, role, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
  )
    .bind(newId(TEST_NOW), eventId, userId, role, TEST_NOW)
    .run();
}

export interface SeededInvite {
  inviteId: string;
  token: string;
  tokenHash: string;
}

export async function seedInvite(input: {
  role: Role;
  eventId?: string | null;
  token?: string;
  expiresAt?: number;
  invitedName?: string | null;
  targetUserId?: string | null;
  createdBy?: string | null;
}): Promise<SeededInvite> {
  const token = input.token ?? randomToken(16);
  const tokenHash = await hmacSha256(PEPPER, token);
  const inviteId = newId(TEST_NOW);

  // Event invites must name an author. Default to the event creator so tests
  // do not have to thread that through every call.
  let createdBy = input.createdBy ?? null;
  if (createdBy === null && input.eventId) {
    const event = await testEnv.DB.prepare("SELECT created_by FROM events WHERE id = ?")
      .bind(input.eventId)
      .first<{ created_by: string }>();
    createdBy = event?.created_by ?? null;
  }

  await testEnv.DB.prepare(
    `INSERT INTO invites
       (id, event_id, role, token_hash, target_user_id, invited_name, created_by,
        created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      inviteId,
      input.eventId ?? null,
      input.role,
      tokenHash,
      input.targetUserId ?? null,
      input.invitedName ?? null,
      createdBy,
      TEST_NOW,
      input.expiresAt ?? TEST_NOW + DAY_MS,
    )
    .run();

  return { inviteId, token, tokenHash };
}

export interface SeededSession {
  sessionId: string;
  token: string;
  cookie: string;
}

/** Inserts a credential + session pair whose token is known to the test. */
export async function createSession(
  userId: string,
  options: { expiresAt?: number; revokedAt?: number | null; label?: string } = {},
): Promise<SeededSession> {
  const token = randomToken(32);
  const tokenHash = await hmacSha256(PEPPER, token);
  const credentialId = newId(TEST_NOW);
  const sessionId = newId(TEST_NOW);

  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO device_credentials (id, user_id, token_hash, label, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(credentialId, userId, tokenHash, options.label ?? null, TEST_NOW),
    testEnv.DB.prepare(
      `INSERT INTO sessions
         (id, token_hash, user_id, credential_id, created_at, last_seen_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      tokenHash,
      userId,
      credentialId,
      TEST_NOW,
      TEST_NOW,
      options.expiresAt ?? TEST_NOW + 30 * DAY_MS,
      options.revokedAt ?? null,
    ),
  ]);

  return { sessionId, token, cookie: `absensi_session=${encodeURIComponent(token)}` };
}

export async function countRows(table: string): Promise<number> {
  const row = await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface SeededParticipant {
  id: string;
  externalRef: string | null;
  fullName: string;
}

export async function createParticipant(
  eventId: string,
  options: {
    id?: string;
    externalRef?: string | null;
    fullName?: string;
    phone?: string | null;
    email?: string | null;
    category?: string | null;
    note?: string | null;
    status?: "active" | "inactive";
  } = {},
): Promise<SeededParticipant> {
  const id = options.id ?? newId(TEST_NOW);
  const externalRef = options.externalRef ?? null;
  const fullName = options.fullName ?? "Peserta Uji";

  await testEnv.DB.prepare(
    `INSERT INTO participants
       (id, event_id, external_ref, full_name, phone, email, category, note,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      eventId,
      externalRef,
      fullName,
      options.phone ?? null,
      options.email ?? null,
      options.category ?? null,
      options.note ?? null,
      options.status ?? "active",
      TEST_NOW,
      TEST_NOW,
    )
    .run();

  return { id, externalRef, fullName };
}

/** Full passwordless login through the real endpoint, returning the cookie. */
export async function loginViaInvite(
  role: Role,
  eventId: string | null,
  now = TEST_NOW,
): Promise<{ cookie: string; userId: string; recoveryCode: string }> {
  const invite = await seedInvite({ role, eventId, invitedName: "Petugas Uji" });

  const response = await callApi("/api/auth/activate", {
    body: { token: invite.token, label: "HP uji" },
    now,
  });

  const cookie = response.sessionCookie();
  if (response.status !== 200 || !cookie) {
    throw new Error(`loginViaInvite failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const body = response.json<{ user: { id: string }; recoveryCode: string }>();
  if (!body.ok) throw new Error("loginViaInvite: unexpected failure envelope");

  return { cookie, userId: body.data.user.id, recoveryCode: body.data.recoveryCode };
}
