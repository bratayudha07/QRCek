import { describe, expect, it } from "vitest";

import { recordAudit } from "../db/audit";
import {
  claimQrCredentialStatement,
  upsertParticipantStatement,
} from "../db/participants";
import { newId } from "../domain/ids";
import { testEnv as env } from "./env";
import { createEvent, createParticipant, createUser } from "./fixtures";
import { TEST_NOW } from "./http";

/**
 * Database-level guarantees for Tahap 4.
 *
 * These tests talk to SQL directly on purpose: the point is that the invariant
 * survives a future code path that forgets the application-level check.
 */

const HASH = "A".repeat(43);
const CIPHERTEXT = "B".repeat(79);
const NONCE = "C".repeat(16);

async function eventAndParticipant(): Promise<{ eventId: string; participantId: string }> {
  const userId = await createUser({ role: "superadmin" });
  const eventId = await createEvent({ createdBy: userId });
  const participant = await createParticipant(eventId, { fullName: "Siti" });

  return { eventId, participantId: participant.id };
}

describe("participant QR columns", () => {
  it("starts nullable, so existing and freshly imported participants stay valid", async () => {
    const { participantId } = await eventAndParticipant();

    const stored = await env.DB.prepare(
      `SELECT qr_token_hash, qr_token_ciphertext, qr_token_nonce, qr_key_version, qr_issued_at
         FROM participants WHERE id = ?`,
    )
      .bind(participantId)
      .first<Record<string, unknown>>();

    expect(stored).toEqual({
      qr_token_hash: null,
      qr_token_ciphertext: null,
      qr_token_nonce: null,
      qr_key_version: null,
      qr_issued_at: null,
    });
  });

  it("keeps the token hash unique across the whole database", async () => {
    const userId = await createUser({ role: "superadmin" });
    const eventA = await createEvent({ createdBy: userId });
    const eventB = await createEvent({ createdBy: userId });
    const first = await createParticipant(eventA, { fullName: "A" });
    const second = await createParticipant(eventB, { fullName: "B" });

    await env.DB.prepare("UPDATE participants SET qr_token_hash = ? WHERE id = ?")
      .bind(HASH, first.id)
      .run();

    await expect(
      env.DB.prepare("UPDATE participants SET qr_token_hash = ? WHERE id = ?")
        .bind(HASH, second.id)
        .run(),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it("rejects malformed credential values through CHECK constraints", async () => {
    const { participantId } = await eventAndParticipant();

    const update = (column: string, value: unknown) =>
      env.DB.prepare(`UPDATE participants SET ${column} = ? WHERE id = ?`)
        .bind(value, participantId)
        .run();

    await expect(update("qr_token_ciphertext", CIPHERTEXT.slice(0, 42))).rejects.toThrow(/CHECK/i);
    await expect(update("qr_token_nonce", NONCE.slice(0, 15))).rejects.toThrow(/CHECK/i);
    await expect(update("qr_key_version", 0)).rejects.toThrow(/CHECK/i);
    await expect(update("qr_issued_at", 0)).rejects.toThrow(/CHECK/i);
    await expect(update("qr_token_hash", HASH.slice(0, 42))).rejects.toThrow(/CHECK/i);
  });

  it("writes a credential exactly once", async () => {
    const { eventId, participantId } = await eventAndParticipant();

    const first = await claimQrCredentialStatement(
      env.DB,
      eventId,
      participantId,
      { tokenHash: HASH, ciphertext: CIPHERTEXT, nonce: NONCE, keyVersion: 1 },
      TEST_NOW,
    ).run();

    expect(first.meta.changes).toBe(1);

    const second = await claimQrCredentialStatement(
      env.DB,
      eventId,
      participantId,
      {
        tokenHash: "D".repeat(43),
        ciphertext: "E".repeat(79),
        nonce: "F".repeat(16),
        keyVersion: 1,
      },
      TEST_NOW + 1000,
    ).run();

    expect(second.meta.changes).toBe(0);

    const stored = await env.DB.prepare(
      "SELECT qr_token_hash, qr_issued_at FROM participants WHERE id = ?",
    )
      .bind(participantId)
      .first<{ qr_token_hash: string; qr_issued_at: number }>();

    expect(stored).toEqual({ qr_token_hash: HASH, qr_issued_at: TEST_NOW });
  });

  it("preserves the credential when CSV import updates the same participant", async () => {
    const userId = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: userId });
    const participant = await createParticipant(eventId, {
      fullName: "Nama Lama",
      externalRef: "A-1",
    });

    await claimQrCredentialStatement(
      env.DB,
      eventId,
      participant.id,
      { tokenHash: HASH, ciphertext: CIPHERTEXT, nonce: NONCE, keyVersion: 1 },
      TEST_NOW,
    ).run();

    await upsertParticipantStatement(env.DB, {
      id: newId(TEST_NOW),
      eventId,
      externalRef: "A-1",
      fullName: "Nama Baru",
      phone: null,
      email: null,
      category: null,
      note: null,
      now: TEST_NOW + 1000,
    }).run();

    const stored = await env.DB.prepare(
      "SELECT full_name, qr_token_hash, qr_token_ciphertext FROM participants WHERE id = ?",
    )
      .bind(participant.id)
      .first<{ full_name: string; qr_token_hash: string; qr_token_ciphertext: string }>();

    expect(stored).toEqual({
      full_name: "Nama Baru",
      qr_token_hash: HASH,
      qr_token_ciphertext: CIPHERTEXT,
    });
  });
});

describe("audit_log append-only", () => {
  it("accepts inserts and rejects updates and deletes at the database level", async () => {
    const userId = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: userId });
    const id = newId(TEST_NOW);

    await recordAudit(env.DB, {
      id,
      eventId,
      actorUserId: userId,
      action: "qr.labels_exported",
      entityType: "event",
      entityId: eventId,
      after: { count: 1 },
      createdAt: TEST_NOW,
    });

    await expect(
      env.DB.prepare("UPDATE audit_log SET action = 'tampered' WHERE id = ?").bind(id).run(),
    ).rejects.toThrow(/append-only/i);

    await expect(
      env.DB.prepare("DELETE FROM audit_log WHERE id = ?").bind(id).run(),
    ).rejects.toThrow(/append-only/i);

    const row = await env.DB.prepare("SELECT action, after_json FROM audit_log WHERE id = ?")
      .bind(id)
      .first<{ action: string; after_json: string }>();

    expect(row).toEqual({ action: "qr.labels_exported", after_json: JSON.stringify({ count: 1 }) });
  });
});
