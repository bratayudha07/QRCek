import type { EventRole, Role } from "@absensi/shared";

import { newId } from "../domain/ids";
import { issueQrCredential, qrKeyConfig } from "../domain/qr-token";
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

/** Active Attendance Aktivitas; Q5 scan needs an explicit context. */
export async function createActivity(
  eventId: string,
  options: {
    id?: string;
    name?: string;
    transactionType?: "attendance" | "consumption";
    status?: "draft" | "active" | "completed" | "archived";
    sortOrder?: number;
    createdBy?: string | null;
  } = {},
): Promise<string> {
  const id = options.id ?? newId(TEST_NOW);
  const status = options.status ?? "active";

  await testEnv.DB.prepare(
    `INSERT INTO activities
       (id, theme_id, name, description, transaction_type, status, location,
        sort_order, created_at, created_by, updated_at, updated_by, archived_at)
     VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      id,
      eventId,
      options.name ?? "Absensi",
      options.transactionType ?? "attendance",
      status,
      options.sortOrder ?? 0,
      TEST_NOW,
      options.createdBy ?? null,
      TEST_NOW,
      status === "archived" ? TEST_NOW : null,
    )
    .run();

  return id;
}

/** Sesi directly in D1; `createSession` above is the auth session. */
export async function createActivitySession(
  activityId: string,
  options: {
    id?: string;
    name?: string;
    status?: "scheduled" | "in_progress" | "completed" | "disabled";
    archivedAt?: number | null;
  } = {},
): Promise<string> {
  const id = options.id ?? newId(TEST_NOW);
  const status = options.status ?? "in_progress";
  const archivedAt = options.archivedAt ?? null;

  await testEnv.DB.prepare(
    `INSERT INTO activity_sessions
       (id, activity_id, name, location, starts_at, ends_at, status,
        archived_at, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, NULL)`,
  )
    .bind(
      id,
      activityId,
      options.name ?? "Sesi Uji",
      status,
      archivedAt,
      TEST_NOW,
      TEST_NOW,
    )
    .run();

  return id;
}

/** Theme-default `allowed`, so a fresh test Tema is not fail-closed. */
export async function allowThemeDefault(eventId: string): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO entitlement_rules
       (id, theme_id, activity_id, session_id, participant_id, category_id,
        status, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, NULL, NULL, NULL, NULL, 'allowed', ?, NULL, ?, NULL)`,
  )
    .bind(newId(TEST_NOW), eventId, TEST_NOW, TEST_NOW)
    .run();
}

/** Q5 scanner authority; Q6 adds the management endpoint. */
export async function addStaffAssignment(
  eventId: string,
  activityId: string,
  userId: string,
  options: { sessionId?: string | null; canManualCheckIn?: boolean } = {},
): Promise<string> {
  const id = newId(TEST_NOW);

  await testEnv.DB.prepare(
    `INSERT INTO staff_assignments
       (id, theme_id, activity_id, session_id, user_id, can_manual_check_in,
        status, created_at, created_by, updated_at, updated_by, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, NULL, NULL)`,
  )
    .bind(
      id,
      eventId,
      activityId,
      options.sessionId ?? null,
      userId,
      options.canManualCheckIn ? 1 : 0,
      TEST_NOW,
      TEST_NOW,
    )
    .run();

  return id;
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
  categoryId: string;
}

/**
 * Inserts a category directly. `createParticipant` calls this on demand so
 * tests do not have to think about the Q2 requirement that every participant
 * has a category.
 */
export async function createCategory(
  eventId: string,
  options: {
    id?: string;
    name?: string;
    description?: string | null;
    sortOrder?: number;
    status?: "active" | "archived";
  } = {},
): Promise<{ id: string; name: string }> {
  const id = options.id ?? newId(TEST_NOW);
  const name = options.name ?? "Kelas Uji";
  const status = options.status ?? "active";

  await testEnv.DB.prepare(
    `INSERT INTO categories
       (id, theme_id, name, description, sort_order, status,
        created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      eventId,
      name,
      options.description ?? null,
      options.sortOrder ?? 0,
      status,
      TEST_NOW,
      TEST_NOW,
      status === "archived" ? TEST_NOW : null,
    )
    .run();

  return { id, name };
}

export async function createCustomField(
  eventId: string,
  options: {
    id?: string;
    key?: string;
    label?: string;
    description?: string | null;
    type?: string;
    required?: boolean;
    options?: string[];
    scope?: "participant" | "activity";
    sortOrder?: number;
    status?: "active" | "archived";
  } = {},
): Promise<{ id: string; key: string }> {
  const id = options.id ?? newId(TEST_NOW);
  const key = options.key ?? `field_${id.slice(-8).toLowerCase()}`;
  const status = options.status ?? "active";

  await testEnv.DB.prepare(
    `INSERT INTO custom_fields
       (id, theme_id, key, label, description, type, required, options_json,
        scope, sort_order, status, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      eventId,
      key,
      options.label ?? key,
      options.description ?? null,
      options.type ?? "text",
      options.required ? 1 : 0,
      options.options ? JSON.stringify(options.options) : null,
      options.scope ?? "participant",
      options.sortOrder ?? 0,
      status,
      TEST_NOW,
      TEST_NOW,
      status === "archived" ? TEST_NOW : null,
    )
    .run();

  return { id, key };
}

async function ensureCategory(eventId: string, name: string): Promise<string> {
  const existing = await testEnv.DB.prepare(
    "SELECT id FROM categories WHERE theme_id = ? AND name = ?",
  )
    .bind(eventId, name)
    .first<{ id: string }>();
  if (existing) return existing.id;
  return (await createCategory(eventId, { name })).id;
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
    categoryId?: string;
    attributes?: Record<string, unknown>;
    note?: string | null;
    status?: "active" | "inactive";
  } = {},
): Promise<SeededParticipant> {
  const id = options.id ?? newId(TEST_NOW);
  const externalRef = options.externalRef ?? null;
  const fullName = options.fullName ?? "Peserta Uji";
  const categoryId =
    options.categoryId ?? (await ensureCategory(eventId, options.category ?? "Kelas Uji"));

  await testEnv.DB.prepare(
    `INSERT INTO participants
       (id, event_id, external_ref, full_name, phone, email, category_id,
        attributes_json, note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      eventId,
      externalRef,
      fullName,
      options.phone ?? null,
      options.email ?? null,
      categoryId,
      JSON.stringify(options.attributes ?? {}),
      options.note ?? null,
      options.status ?? "active",
      TEST_NOW,
      TEST_NOW,
    )
    .run();

  return { id, externalRef, fullName, categoryId };
}

/** Issues a real identity row, for scan and label tests (Q4). */
export async function issueParticipantQr(
  eventId: string,
  participantId: string,
): Promise<string> {
  const config = await qrKeyConfig(testEnv);
  const { token, credential } = await issueQrCredential(config);

  await testEnv.DB.prepare(
    `INSERT INTO qr_identities
       (id, theme_id, participant_id, token_hash, ciphertext, nonce,
        key_version, issued_at, rotation_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      newId(TEST_NOW),
      eventId,
      participantId,
      credential.tokenHash,
      credential.ciphertext,
      credential.nonce,
      credential.keyVersion,
      TEST_NOW,
    )
    .run();

  return `absensi:v1:${token}`;
}

/**
 * Writes a credential the way a pre-`0010` deployment did. Used to prove that
 * promotion keeps an already-printed card valid.
 */
export async function seedLegacyParticipantQr(
  eventId: string,
  participantId: string,
): Promise<string> {
  const config = await qrKeyConfig(testEnv);
  const { token, credential } = await issueQrCredential(config);

  const result = await testEnv.DB.prepare(
    `UPDATE participants
        SET qr_token_hash = ?, qr_token_ciphertext = ?, qr_token_nonce = ?,
            qr_key_version = ?, qr_issued_at = ?
      WHERE event_id = ? AND id = ?`,
  )
    .bind(
      credential.tokenHash,
      credential.ciphertext,
      credential.nonce,
      credential.keyVersion,
      TEST_NOW,
      eventId,
      participantId,
    )
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new Error("seedLegacyParticipantQr: participant not found");
  }

  return `absensi:v1:${token}`;
}

/** Full passwordless login through the real endpoint, returning the cookie. */export async function loginViaInvite(
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
