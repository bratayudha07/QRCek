import { describe, expect, it } from "vitest";

import { newId } from "../domain/ids";
import { testEnv } from "./env";
import {
  addMembership,
  createActivity,
  createActivitySession,
  createCategory,
  createEvent,
  createParticipant,
  createUser,
} from "./fixtures";
import { TEST_NOW } from "./http";

/**
 * Direct D1 tests for the Q7 quota rules (migration `0012`).
 *
 * These bypass the Worker on purpose: a ceiling that only holds because the
 * route counts first is not enforced by the database, and two parallel requests
 * would both pass. Each assertion fails if the corresponding trigger, CHECK, or
 * partial unique index is removed.
 */

interface World {
  adminId: string;
  themeId: string;
  activityId: string;
  categoryId: string;
  participantId: string;
}

async function world(options: { quota?: number } = {}): Promise<World> {
  const adminId = await createUser({ role: "event_admin", displayName: "Admin Kuota" });
  const themeId = await createEvent({ createdBy: adminId, name: "Acara Kuota" });
  await testEnv.DB.prepare("UPDATE events SET status = 'active' WHERE id = ?")
    .bind(themeId)
    .run();
  await addMembership(themeId, adminId, "event_admin");

  const activityId = await createActivity(themeId, {
    name: "Distribusi Konsumsi",
    transactionType: "consumption",
    quota: options.quota ?? 1,
  });
  const category = await createCategory(themeId, { name: "Kelas Konsumsi" });
  const participant = await createParticipant(themeId, {
    categoryId: category.id,
    fullName: "Peserta Konsumsi",
  });

  return {
    adminId,
    themeId,
    activityId,
    categoryId: category.id,
    participantId: participant.id,
  };
}

interface ConsumptionInput {
  id?: string;
  themeId: string;
  activityId: string;
  participantId: string;
  sessionId?: string | null;
  slotNo: number;
  adjustsTransactionId?: string | null;
}

function consumptionStatement(input: ConsumptionInput): D1PreparedStatement {
  return testEnv.DB.prepare(
    `INSERT INTO transactions
       (id, theme_id, activity_id, session_id, participant_id, type, source, status,
        occurred_at, device_ts, recorded_by, note, slot_no, adjusts_transaction_id,
        reversed_at, reversed_by, superseded_at, superseded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'consumption', 'qr_scan', NULL, ?, NULL, NULL, NULL, ?, ?,
             NULL, NULL, NULL, NULL, ?, ?)`,
  ).bind(
    input.id ?? newId(TEST_NOW),
    input.themeId,
    input.activityId,
    input.sessionId ?? null,
    input.participantId,
    TEST_NOW,
    input.slotNo,
    input.adjustsTransactionId ?? null,
    TEST_NOW,
    TEST_NOW,
  );
}

function insertConsumption(input: ConsumptionInput) {
  return consumptionStatement(input).run();
}

async function effectiveCount(input: {
  themeId: string;
  activityId: string;
  participantId: string;
}): Promise<number> {
  const row = await testEnv.DB.prepare(
    `SELECT COUNT(*) AS n FROM transactions
      WHERE theme_id = ? AND activity_id = ? AND participant_id = ?
        AND type = 'consumption'
        AND reversed_at IS NULL AND superseded_at IS NULL`,
  )
    .bind(input.themeId, input.activityId, input.participantId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function insertQuota(input: {
  themeId: string;
  activityId: string;
  categoryId?: string | null;
  participantId?: string | null;
  quota: number;
}) {
  await testEnv.DB.prepare(
    `INSERT INTO consumption_quotas
       (id, theme_id, activity_id, category_id, participant_id, quota,
        created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
  )
    .bind(
      newId(TEST_NOW),
      input.themeId,
      input.activityId,
      input.categoryId ?? null,
      input.participantId ?? null,
      input.quota,
      TEST_NOW,
      TEST_NOW,
    )
    .run();
}

describe("consumption quota ceiling (0012)", () => {
  it("T-120: rejects the over-quota insert inside db.batch and writes nothing", async () => {
    const w = await world({ quota: 1 });

    // Two parallel requests, both counted 0 used before either wrote. Only the
    // database trigger can stop the second one.
    await expect(
      testEnv.DB.batch([
        consumptionStatement({ ...w, slotNo: 1 }),
        consumptionStatement({ ...w, slotNo: 2 }),
      ]),
    ).rejects.toThrow(/consumption quota exhausted/);

    expect(await effectiveCount(w)).toBe(0);
  });

  it("counts usage across every Sesi of the Aktivitas (A1)", async () => {
    const w = await world({ quota: 1 });
    const first = await createActivitySession(w.activityId, { name: "Sesi 1" });
    const second = await createActivitySession(w.activityId, { name: "Sesi 2" });

    await insertConsumption({ ...w, sessionId: first, slotNo: 1 });
    await expect(
      insertConsumption({ ...w, sessionId: second, slotNo: 2 }),
    ).rejects.toThrow(/consumption quota exhausted/);
  });

  it("does not apply the ceiling to an Adjustment replacement (A6)", async () => {
    const w = await world({ quota: 1 });
    const original = newId(TEST_NOW);

    await consumptionStatement({ ...w, id: original, slotNo: 1 }).run();

    // A superseded row leaves the effective set, and the replacement keeps the
    // same slot without consuming another unit of quota.
    await testEnv.DB.prepare(
      "UPDATE transactions SET superseded_at = ?, superseded_by = ? WHERE id = ?",
    )
      .bind(TEST_NOW, w.adminId, original)
      .run();

    await insertConsumption({
      ...w,
      slotNo: 1,
      adjustsTransactionId: original,
    });

    expect(await effectiveCount(w)).toBe(1);
  });
});

describe("consumption quota resolution levels (T-121)", () => {
  it("enforces the Aktivitas default", async () => {
    const w = await world({ quota: 2 });

    await insertConsumption({ ...w, slotNo: 1 });
    await insertConsumption({ ...w, slotNo: 2 });
    await expect(insertConsumption({ ...w, slotNo: 3 })).rejects.toThrow(
      /consumption quota exhausted/,
    );
  });

  it("lets a category override raise the ceiling", async () => {
    const w = await world({ quota: 1 });
    await insertQuota({ themeId: w.themeId, activityId: w.activityId, categoryId: w.categoryId, quota: 3 });

    await insertConsumption({ ...w, slotNo: 1 });
    await insertConsumption({ ...w, slotNo: 2 });
    await insertConsumption({ ...w, slotNo: 3 });
    await expect(insertConsumption({ ...w, slotNo: 4 })).rejects.toThrow(
      /consumption quota exhausted/,
    );
  });

  it("lets an individual override win over the category and the default", async () => {
    const w = await world({ quota: 1 });
    await insertQuota({ themeId: w.themeId, activityId: w.activityId, categoryId: w.categoryId, quota: 1 });
    await insertQuota({ themeId: w.themeId, activityId: w.activityId, participantId: w.participantId, quota: 2 });

    await insertConsumption({ ...w, slotNo: 1 });
    await insertConsumption({ ...w, slotNo: 2 });
    await expect(insertConsumption({ ...w, slotNo: 3 })).rejects.toThrow(
      /consumption quota exhausted/,
    );
  });

  it("rejects the first transaction when the effective quota is 0", async () => {
    const w = await world({ quota: 1 });
    await insertQuota({ themeId: w.themeId, activityId: w.activityId, participantId: w.participantId, quota: 0 });

    await expect(insertConsumption({ ...w, slotNo: 1 })).rejects.toThrow(
      /consumption quota exhausted/,
    );
  });
});

describe("consumption Reversal and configuration history (T-122, T-123)", () => {
  it("T-122: frees both the quota and the slot when a transaction is reversed", async () => {
    const w = await world({ quota: 2 });
    const first = newId(TEST_NOW);

    await testEnv.DB.prepare(
      `INSERT INTO transactions
         (id, theme_id, activity_id, session_id, participant_id, type, source,
          status, occurred_at, device_ts, recorded_by, note, slot_no,
          adjusts_transaction_id, reversed_at, reversed_by, superseded_at,
          superseded_by, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'consumption', 'qr_scan', NULL, ?, NULL, NULL,
               NULL, 1, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
      .bind(first, w.themeId, w.activityId, w.participantId, TEST_NOW, TEST_NOW, TEST_NOW)
      .run();

    // Quota still has room, so this rejection is the slot unique index.
    await expect(insertConsumption({ ...w, slotNo: 1 })).rejects.toThrow(
      /UNIQUE constraint failed/,
    );

    await testEnv.DB.prepare(
      "UPDATE transactions SET reversed_at = ?, reversed_by = ? WHERE id = ?",
    )
      .bind(TEST_NOW, w.adminId, first)
      .run();

    await insertConsumption({ ...w, slotNo: 1 });
    expect(await effectiveCount(w)).toBe(1);
  });

  it("T-123: keeps history when the quota changes", async () => {
    const w = await world({ quota: 1 });
    await insertConsumption({ ...w, slotNo: 1 });

    await testEnv.DB.prepare(
      "UPDATE activities SET quota = 3, updated_at = ? WHERE id = ?",
    )
      .bind(TEST_NOW + 1, w.activityId)
      .run();

    const total = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE activity_id = ?",
    )
      .bind(w.activityId)
      .first<{ n: number }>();
    expect(total?.n).toBe(1);
    expect(await effectiveCount(w)).toBe(1);

    // Lowering the quota is future-only: it never rewrites a past transaction.
    await testEnv.DB.prepare(
      "UPDATE activities SET quota = 0, updated_at = ? WHERE id = ?",
    )
      .bind(TEST_NOW + 2, w.activityId)
      .run();

    expect(await effectiveCount(w)).toBe(1);
    await expect(insertConsumption({ ...w, slotNo: 2 })).rejects.toThrow(
      /consumption quota exhausted/,
    );
  });
});

describe("consumption quota context guards", () => {
  it("rejects an override whose Aktivitas belongs to another Tema", async () => {
    const w = await world();
    const other = await world();

    await expect(
      insertQuota({
        themeId: w.themeId,
        activityId: other.activityId,
        categoryId: w.categoryId,
        quota: 2,
      }),
    ).rejects.toThrow(/activity does not belong to this theme/);
  });

  it("rejects an override on an attendance Aktivitas", async () => {
    const w = await world();
    const attendanceActivity = await createActivity(w.themeId, {
      name: "Absensi",
      transactionType: "attendance",
    });

    await expect(
      insertQuota({
        themeId: w.themeId,
        activityId: attendanceActivity,
        categoryId: w.categoryId,
        quota: 2,
      }),
    ).rejects.toThrow(/activity is not a consumption activity/);
  });

  it("rejects a category and a participant from another Tema", async () => {
    const w = await world();
    const other = await world();

    await expect(
      insertQuota({
        themeId: w.themeId,
        activityId: w.activityId,
        categoryId: other.categoryId,
        quota: 2,
      }),
    ).rejects.toThrow(/category does not belong to this theme/);

    await expect(
      insertQuota({
        themeId: w.themeId,
        activityId: w.activityId,
        participantId: other.participantId,
        quota: 2,
      }),
    ).rejects.toThrow(/participant does not belong to this theme/);
  });

  it("allows only one override per category and per participant", async () => {
    const w = await world();
    await insertQuota({ themeId: w.themeId, activityId: w.activityId, categoryId: w.categoryId, quota: 2 });
    await insertQuota({ themeId: w.themeId, activityId: w.activityId, participantId: w.participantId, quota: 2 });

    await expect(insertQuota({ themeId: w.themeId, activityId: w.activityId, categoryId: w.categoryId, quota: 3 })).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
    await expect(
      insertQuota({ themeId: w.themeId, activityId: w.activityId, participantId: w.participantId, quota: 3 }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe("activity quota type guards", () => {
  it("rejects a quota on an attendance Aktivitas", async () => {
    const adminId = await createUser({ role: "event_admin" });
    const themeId = await createEvent({ createdBy: adminId });

    await expect(
      createActivity(themeId, { transactionType: "attendance", quota: 1 }),
    ).rejects.toThrow(/attendance activity must not have a quota/);
  });

  it("rejects a consumption Aktivitas without a quota", async () => {
    const adminId = await createUser({ role: "event_admin" });
    const themeId = await createEvent({ createdBy: adminId });

    await expect(
      createActivity(themeId, { transactionType: "consumption", quota: null }),
    ).rejects.toThrow(/consumption activity requires a quota/);
  });

  it("rejects a negative quota on update", async () => {
    const w = await world({ quota: 1 });

    await expect(
      testEnv.DB.prepare("UPDATE activities SET quota = -1 WHERE id = ?")
        .bind(w.activityId)
        .run(),
    ).rejects.toThrow(/quota must not be negative/);
  });
});

describe("quota read path", () => {
  it("uses the effective-consumption index for the quota count", async () => {
    const w = await world({ quota: 1 });

    const { results } = await testEnv.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT slot_no
         FROM transactions
        WHERE theme_id = ? AND participant_id = ? AND activity_id = ?
          AND type = 'consumption'
          AND reversed_at IS NULL
          AND superseded_at IS NULL
        ORDER BY slot_no`,
    )
      .bind(w.themeId, w.participantId, w.activityId)
      .all<{ detail: string }>();

    const plan = results.map((row) => row.detail).join("\n");
    expect(plan).toMatch(/idx_tx_consumption_effective/);
    expect(plan).toMatch(/SEARCH/);
  });
});
