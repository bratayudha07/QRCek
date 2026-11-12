import { describe, expect, it } from "vitest";

import { newId } from "../domain/ids";
import {
  addMembership,
  createActivity,
  createActivitySession,
  createEvent,
  createParticipant,
  createUser,
} from "./fixtures";
import { testEnv } from "./env";
import { TEST_NOW } from "./http";

/**
 * Direct D1 tests for the Q5 integrity rules (migration `0011`).
 *
 * These bypass the Worker on purpose: a rule that only holds because the route
 * checks it first is not enforced by the database. Each assertion fails if the
 * corresponding partial index, CHECK, or trigger is removed.
 */

interface World {
  adminId: string;
  eventId: string;
  themeId: string;
  activityId: string;
  participantId: string;
}

async function world(): Promise<World> {
  const adminId = await createUser({ role: "event_admin", displayName: "Admin DB" });
  const eventId = await createEvent({ createdBy: adminId });
  await testEnv.DB.prepare("UPDATE events SET status = 'active' WHERE id = ?").bind(eventId).run();
  await addMembership(eventId, adminId, "event_admin");

  const activityId = await createActivity(eventId);
  const participant = await createParticipant(eventId, { fullName: "Peserta DB" });

  return { adminId, eventId, themeId: eventId, activityId, participantId: participant.id };
}

interface TransactionInput {
  themeId: string;
  activityId: string;
  participantId: string;
  sessionId?: string | null;
  type?: "attendance" | "consumption";
  status?: "present" | "late" | "absent" | "excused";
  slotNo?: number | null;
  occurredAt?: number;
  reversedAt?: number | null;
  reversedBy?: string | null;
  supersededAt?: number | null;
  supersededBy?: string | null;
  adjustsTransactionId?: string | null;
  id?: string;
}

function insertTransaction(input: TransactionInput) {
  const type = input.type ?? "attendance";
  const status = type === "attendance" ? (input.status ?? "present") : null;
  const slotNo = type === "consumption" ? (input.slotNo ?? 1) : null;

  return testEnv.DB.prepare(
    `INSERT INTO transactions
       (id, theme_id, activity_id, session_id, participant_id, type, source, status,
        occurred_at, device_ts, recorded_by, note, slot_no, adjusts_transaction_id,
        reversed_at, reversed_by, superseded_at, superseded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'qr_scan', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id ?? newId(TEST_NOW),
      input.themeId,
      input.activityId,
      input.sessionId ?? null,
      input.participantId,
      type,
      status,
      input.occurredAt ?? TEST_NOW,
      slotNo,
      input.adjustsTransactionId ?? null,
      input.reversedAt ?? null,
      input.reversedBy ?? null,
      input.supersededAt ?? null,
      input.supersededBy ?? null,
      TEST_NOW,
      TEST_NOW,
    )
    .run();
}

describe("transactions constraints (0011)", () => {
  it("rejects a second effective Attendance row in the same Aktivitas without Sesi", async () => {
    const w = await world();
    await insertTransaction(w);

    await expect(insertTransaction(w)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("keeps one effective row per Sesi but allows a different Sesi", async () => {
    const w = await world();
    const first = await createActivitySession(w.activityId, { name: "Sesi 1" });
    const second = await createActivitySession(w.activityId, { name: "Sesi 2" });

    await insertTransaction({ ...w, sessionId: first });
    await expect(insertTransaction({ ...w, sessionId: first })).rejects.toThrow(
      /UNIQUE constraint failed/,
    );

    await insertTransaction({ ...w, sessionId: second });
  });

  it("frees the slot after a Reversal and after a supersede", async () => {
    const w = await world();
    const first = newId(TEST_NOW);
    await insertTransaction({ ...w, id: first });

    await testEnv.DB.prepare(
      "UPDATE transactions SET reversed_at = ?, reversed_by = ? WHERE id = ?",
    )
      .bind(TEST_NOW, w.adminId, first)
      .run();

    const second = newId(TEST_NOW);
    await insertTransaction({ ...w, id: second });

    await testEnv.DB.prepare(
      "UPDATE transactions SET superseded_at = ?, superseded_by = ? WHERE id = ?",
    )
      .bind(TEST_NOW, w.adminId, second)
      .run();

    await insertTransaction({ ...w });
  });

  it("rejects an Aktivitas that belongs to another Tema", async () => {
    const w = await world();
    const otherAdmin = await createUser({ role: "event_admin" });
    const otherEvent = await createEvent({ createdBy: otherAdmin });
    const foreignActivity = await createActivity(otherEvent);

    await expect(
      insertTransaction({ ...w, activityId: foreignActivity }),
    ).rejects.toThrow(/does not belong to this theme/);
  });

  it("rejects a Participant from another Tema", async () => {
    const w = await world();
    const otherAdmin = await createUser({ role: "event_admin" });
    const otherEvent = await createEvent({ createdBy: otherAdmin });
    const foreignParticipant = await createParticipant(otherEvent);

    await expect(
      insertTransaction({ ...w, participantId: foreignParticipant.id }),
    ).rejects.toThrow(/does not belong to this theme/);
  });

  it("requires a Sesi when the Aktivitas owns one", async () => {
    const w = await world();
    await createActivitySession(w.activityId);

    await expect(insertTransaction(w)).rejects.toThrow(/session required/);
  });

  it("rejects a new transaction on an inactive Tema", async () => {
    const w = await world();
    await testEnv.DB.prepare("UPDATE events SET status = 'closed' WHERE id = ?")
      .bind(w.eventId)
      .run();

    await expect(insertTransaction(w)).rejects.toThrow(/theme not active/);
  });

  it("rejects a Sesi that is not in progress", async () => {
    const w = await world();
    const sessionId = await createActivitySession(w.activityId, { status: "scheduled" });

    await expect(insertTransaction({ ...w, sessionId })).rejects.toThrow(/session not in progress/);
  });

  it("makes transaction_corrections append-only", async () => {
    const w = await world();
    const transactionId = newId(TEST_NOW);
    await insertTransaction({ ...w, id: transactionId });

    const correctionId = newId(TEST_NOW);
    await testEnv.DB.prepare(
      `INSERT INTO transaction_corrections
         (id, transaction_id, operation, reason, actor_user_id, before_json, after_json, created_at)
       VALUES (?, ?, 'reversal', ?, ?, NULL, NULL, ?)`,
    )
      .bind(correctionId, transactionId, "Salah pindai", w.adminId, TEST_NOW)
      .run();

    await expect(
      testEnv.DB.prepare("UPDATE transaction_corrections SET reason = 'x' WHERE id = ?")
        .bind(correctionId)
        .run(),
    ).rejects.toThrow(/append-only/);

    await expect(
      testEnv.DB.prepare("DELETE FROM transaction_corrections WHERE id = ?")
        .bind(correctionId)
        .run(),
    ).rejects.toThrow(/append-only/);
  });
});

describe("staff_assignments constraints (0011)", () => {
  it("rejects an Aktivitas from another Tema and a non-member user", async () => {
    const w = await world();
    const officerId = await createUser({ role: "officer" });
    await addMembership(w.eventId, officerId, "officer");

    const otherAdmin = await createUser({ role: "event_admin" });
    const otherEvent = await createEvent({ createdBy: otherAdmin });
    const foreignActivity = await createActivity(otherEvent);

    const insert = (themeId: string, activityId: string, userId: string) =>
      testEnv.DB.prepare(
        `INSERT INTO staff_assignments
           (id, theme_id, activity_id, session_id, user_id, can_manual_check_in,
            status, created_at, created_by, updated_at, updated_by, revoked_at)
         VALUES (?, ?, ?, NULL, ?, 0, 'active', ?, NULL, ?, NULL, NULL)`,
      )
        .bind(newId(TEST_NOW), themeId, activityId, userId, TEST_NOW, TEST_NOW)
        .run();

    await expect(insert(w.eventId, foreignActivity, officerId)).rejects.toThrow(
      /does not belong to this theme/,
    );

    const outsiderId = await createUser({ role: "officer" });
    await expect(insert(w.eventId, w.activityId, outsiderId)).rejects.toThrow(
      /not an active member/,
    );

    await insert(w.eventId, w.activityId, officerId);
  });
});
