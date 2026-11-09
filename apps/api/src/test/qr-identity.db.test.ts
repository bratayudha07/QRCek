import { describe, expect, it } from "vitest";

import {
  findIdentityForParticipant,
  findIdentityParticipantByHash,
  insertQrIdentityStatement,
  mirrorRotatedCredentialToLegacyStatement,
  rotateQrIdentityStatement,
} from "../db/qr-identities";
import { newId } from "../domain/ids";
import { testEnv as env } from "./env";
import { createEvent, createParticipant, createUser } from "./fixtures";
import { TEST_NOW } from "./http";

/**
 * T-Q4 database rules (ADR-0017): one active identity per Tema + Peserta, one
 * hash per identity, cross-Tema rows rejected by the database, and rotation in
 * place with an optimistic counter.
 */

const HASH = "a".repeat(43);
const OTHER_HASH = "b".repeat(43);
const CIPHERTEXT = "c".repeat(79);
const NONCE = "d".repeat(16);

async function world(): Promise<{ eventA: string; eventB: string; participantA: string }> {
  const userId = await createUser({ role: "superadmin" });
  const eventA = await createEvent({ createdBy: userId, name: "Tema A" });
  const eventB = await createEvent({ createdBy: userId, name: "Tema B" });
  const participant = await createParticipant(eventA, { fullName: "Peserta A" });

  return { eventA, eventB, participantA: participant.id };
}

function seedIdentity(input: {
  themeId: string;
  participantId: string;
  hash?: string;
}): D1PreparedStatement {
  return insertQrIdentityStatement(env.DB, {
    id: newId(TEST_NOW),
    themeId: input.themeId,
    participantId: input.participantId,
    credential: {
      tokenHash: input.hash ?? HASH,
      ciphertext: CIPHERTEXT,
      nonce: NONCE,
      keyVersion: 1,
    },
    issuedAt: TEST_NOW,
  });
}

/** Raw insert, bypassing the `DO NOTHING` clause, to test the unique index. */
function rawIdentityStatement(input: {
  themeId: string;
  participantId: string;
  hash?: string;
}): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO qr_identities
       (id, theme_id, participant_id, token_hash, ciphertext, nonce,
        key_version, issued_at, rotation_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).bind(
    newId(TEST_NOW),
    input.themeId,
    input.participantId,
    input.hash ?? HASH,
    CIPHERTEXT,
    NONCE,
    1,
    TEST_NOW,
  );
}

describe("qr_identities schema", () => {
  it("ships the table, both unique indexes, and the context triggers", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'qr_identities'",
    ).all<{ name: string }>();
    expect(tables.results).toHaveLength(1);

    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'qr_identities' AND name LIKE 'uq_%' ORDER BY name",
    ).all<{ name: string }>();
    expect(indexes.results.map((row) => row.name)).toEqual([
      "uq_qr_identity_hash",
      "uq_qr_identity_participant",
    ]);

    const triggers = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'qr_identities' ORDER BY name",
    ).all<{ name: string }>();
    expect(triggers.results.map((row) => row.name)).toEqual([
      "trg_qr_identity_context_insert",
      "trg_qr_identity_context_update",
    ]);
  });

  it("rejects a second identity for the same Tema + Peserta", async () => {
    const { eventA, participantA } = await world();
    await seedIdentity({ themeId: eventA, participantId: participantA }).run();

    await expect(
      rawIdentityStatement({ themeId: eventA, participantId: participantA, hash: OTHER_HASH }).run(),
    ).rejects.toThrow(/UNIQUE constraint failed/i);

    // The production helper is stricter than "throw": a race loses by writing
    // nothing, so a concurrent printer adopts the winner instead of failing.
    const loser = await seedIdentity({
      themeId: eventA,
      participantId: participantA,
      hash: OTHER_HASH,
    }).run();
    expect(loser.meta.changes).toBe(0);
  });

  it("rejects a hash that already belongs to another identity", async () => {
    const { eventA, participantA } = await world();
    const other = await createParticipant(eventA, { fullName: "Peserta Lain" });

    await seedIdentity({ themeId: eventA, participantId: participantA }).run();

    await expect(rawIdentityStatement({ themeId: eventA, participantId: other.id }).run()).rejects.toThrow(
      /UNIQUE constraint failed/i,
    );
  });

  it("rejects a participant from a different Tema at the database boundary", async () => {
    const { eventB, participantA } = await world();

    await expect(
      seedIdentity({ themeId: eventB, participantId: participantA }).run(),
    ).rejects.toThrow(/participant does not belong to this theme/i);
  });

  it("rejects malformed credential lengths", async () => {
    const { eventA, participantA } = await world();

    await expect(
      seedIdentity({ themeId: eventA, participantId: participantA, hash: "too-short" }).run(),
    ).rejects.toThrow(/CHECK constraint/i);
  });
});

describe("qr_identities backfill", () => {
  function backfillQuery(): string {
    const migration = __MIGRATIONS__.find((item) => item.name === "0010_qr_identities.sql");
    if (!migration) throw new Error("migration 0010 is missing");

    const query = migration.queries.find((item) => item.includes("INSERT INTO qr_identities"));
    if (!query) throw new Error("backfill query is missing");

    return query;
  }

  it("copies complete legacy credentials and skips incomplete ones", async () => {
    const { eventA, participantA } = await world();
    const incomplete = await createParticipant(eventA, { fullName: "Setengah" });

    await env.DB.prepare(
      `UPDATE participants
          SET qr_token_hash = ?, qr_token_ciphertext = ?, qr_token_nonce = ?,
              qr_key_version = ?, qr_issued_at = ?
        WHERE id = ?`,
    )
      .bind(HASH, CIPHERTEXT, NONCE, 2, TEST_NOW - 500, participantA)
      .run();

    // Only the hash: this is the half-written state the backfill must ignore.
    await env.DB.prepare("UPDATE participants SET qr_token_hash = ? WHERE id = ?")
      .bind(OTHER_HASH, incomplete.id)
      .run();

    await env.DB.prepare(backfillQuery()).run();

    const copied = await findIdentityForParticipant(env.DB, eventA, participantA);
    expect(copied?.token_hash).toBe(HASH);
    expect(copied?.ciphertext).toBe(CIPHERTEXT);
    expect(copied?.nonce).toBe(NONCE);
    expect(copied?.key_version).toBe(2);
    expect(copied?.issued_at).toBe(TEST_NOW - 500);
    expect(copied?.rotation_count).toBe(0);
    expect(copied?.rotated_at).toBeNull();

    expect(await findIdentityForParticipant(env.DB, eventA, incomplete.id)).toBeNull();

    // Replaying the block (e.g. on a database copy) does not duplicate rows.
    await env.DB.prepare(backfillQuery()).run();
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM qr_identities WHERE theme_id = ? AND participant_id = ?",
    )
      .bind(eventA, participantA)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});

describe("qr_identities rotation", () => {
  it("updates the same row in place and bumps the counter", async () => {
    const { eventA, participantA } = await world();
    await seedIdentity({ themeId: eventA, participantId: participantA }).run();

    const before = await findIdentityForParticipant(env.DB, eventA, participantA);
    expect(before).not.toBeNull();

    const results = await env.DB.batch([
      rotateQrIdentityStatement(env.DB, {
        themeId: eventA,
        participantId: participantA,
        credential: {
          tokenHash: OTHER_HASH,
          ciphertext: CIPHERTEXT,
          nonce: NONCE,
          keyVersion: 1,
        },
        rotatedAt: TEST_NOW + 1000,
        expectedRotationCount: 0,
      }),
      mirrorRotatedCredentialToLegacyStatement(env.DB, {
        identityId: before?.id as string,
        themeId: eventA,
        participantId: participantA,
        credential: {
          tokenHash: OTHER_HASH,
          ciphertext: CIPHERTEXT,
          nonce: NONCE,
          keyVersion: 1,
        },
        issuedAt: before?.issued_at as number,
      }),
    ]);

    expect(results[0]?.meta.changes).toBe(1);
    expect(results[1]?.meta.changes).toBe(1);

    const after = await findIdentityForParticipant(env.DB, eventA, participantA);
    expect(after?.id).toBe(before?.id);
    expect(after?.token_hash).toBe(OTHER_HASH);
    expect(after?.rotation_count).toBe(1);
    expect(after?.rotated_at).toBe(TEST_NOW + 1000);

    // The legacy mirror follows the rotation, so a Worker rollback cannot
    // revive the revoked token (FR-059, AC-016).
    const legacy = await env.DB.prepare(
      `SELECT qr_token_hash, qr_token_ciphertext, qr_token_nonce, qr_key_version, qr_issued_at
         FROM participants WHERE event_id = ? AND id = ?`,
    )
      .bind(eventA, participantA)
      .first<{
        qr_token_hash: string;
        qr_token_ciphertext: string;
        qr_token_nonce: string;
        qr_key_version: number;
        qr_issued_at: number;
      }>();

    expect(legacy).toMatchObject({
      qr_token_hash: OTHER_HASH,
      qr_token_ciphertext: CIPHERTEXT,
      qr_token_nonce: NONCE,
      qr_key_version: 1,
      qr_issued_at: TEST_NOW,
    });

    // The old hash is gone: the scan lookup cannot find it any more.
    expect(await findIdentityParticipantByHash(env.DB, HASH)).toBeNull();
    expect(await findIdentityParticipantByHash(env.DB, OTHER_HASH)).not.toBeNull();
  });

  it("does nothing when the expected rotation counter is stale", async () => {
    const { eventA, participantA } = await world();
    await seedIdentity({ themeId: eventA, participantId: participantA }).run();

    const identity = await findIdentityForParticipant(env.DB, eventA, participantA);
    const results = await env.DB.batch([
      rotateQrIdentityStatement(env.DB, {
        themeId: eventA,
        participantId: participantA,
        credential: {
          tokenHash: OTHER_HASH,
          ciphertext: CIPHERTEXT,
          nonce: NONCE,
          keyVersion: 1,
        },
        rotatedAt: TEST_NOW + 1000,
        expectedRotationCount: 7,
      }),
      mirrorRotatedCredentialToLegacyStatement(env.DB, {
        identityId: identity?.id as string,
        themeId: eventA,
        participantId: participantA,
        credential: {
          tokenHash: OTHER_HASH,
          ciphertext: CIPHERTEXT,
          nonce: NONCE,
          keyVersion: 1,
        },
        issuedAt: identity?.issued_at as number,
      }),
    ]);

    expect(results[0]?.meta.changes).toBe(0);
    expect(results[1]?.meta.changes).toBe(0);

    const row = await findIdentityForParticipant(env.DB, eventA, participantA);
    expect(row?.token_hash).toBe(HASH);
    expect(row?.rotation_count).toBe(0);

    const legacy = await env.DB.prepare(
      "SELECT qr_token_hash FROM participants WHERE id = ?",
    )
      .bind(participantA)
      .first<{ qr_token_hash: string | null }>();
    expect(legacy?.qr_token_hash).toBeNull();
  });

  it("looks up a scan hash with one index search and the participant row", async () => {
    const { eventA, participantA } = await world();
    await seedIdentity({ themeId: eventA, participantId: participantA }).run();

    const found = await findIdentityParticipantByHash(env.DB, HASH);
    expect(found?.id).toBe(participantA);
    expect(found?.identity_theme_id).toBe(eventA);
    expect(found?.status).toBe("active");

    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT q.id, p.id FROM qr_identities q JOIN participants p ON p.id = q.participant_id WHERE q.token_hash = ?",
    )
      .bind(HASH)
      .all<{ detail: string }>();

    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toContain("SEARCH");
    expect(details).toContain("uq_qr_identity_hash");
  });
});
