import type { ScanResultPayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  addMembership,
  createEvent,
  createParticipant,
  createSession,
  createUser,
  issueParticipantQr,
} from "../test/fixtures";
import { testEnv } from "../test/env";
import { TEST_NOW, callApi } from "../test/http";
import type { SheetTarget, SheetsGateway, SheetWriteRow } from "../domain/sheets";
import { processOutbox } from "./outbox";

/**
 * Outbox behaviour against the real D1 schema, with a fake Sheets gateway.
 * No test reaches the network (AGENTS.md).
 */

class FakeGateway implements SheetsGateway {
  layouts = 0;
  writes: Array<{ target: SheetTarget; rows: SheetWriteRow[] }> = [];
  failure: unknown = null;

  async test(): Promise<{ spreadsheetTitle: string }> {
    return { spreadsheetTitle: "Spreadsheet Uji" };
  }

  async ensureLayout(): Promise<void> {
    if (this.failure) throw this.failure;
    this.layouts += 1;
  }

  async writeRows(target: SheetTarget, rows: SheetWriteRow[]): Promise<void> {
    if (this.failure) throw this.failure;
    this.writes.push({ target, rows });
  }
}

async function setup() {
  const adminId = await createUser({ role: "event_admin" });
  const eventId = await createEvent({ createdBy: adminId, name: "Acara Sync" });

  await testEnv.DB.prepare(
    "UPDATE events SET status = 'active' WHERE id = ?",
  )
    .bind(eventId)
    .run();

  const officerId = await createUser({ role: "officer" });
  await addMembership(eventId, officerId, "officer");
  const cookie = (await createSession(officerId)).cookie;

  const participant = await createParticipant(eventId, { fullName: "Budi Sync" });
  const qr = await issueParticipantQr(eventId, participant.id);

  return { eventId, participant, cookie, qr };
}

async function enableSync(eventId: string): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO sync_state
       (event_id, spreadsheet_id, sheet_tab, sync_enabled, schema_version, updated_at)
     VALUES (?, 'spreadsheet-uji-123', 'Absensi', 1, 1, ?)`,
  )
    .bind(eventId, TEST_NOW)
    .run();
}

async function scanOnce(cookie: string, eventId: string, qr: string): Promise<void> {
  const response = await callApi(`/api/events/${eventId}/scan`, {
    method: "POST",
    body: { qr },
    cookie,
  });
  const body = response.json<ScanResultPayload>();
  expect(body.ok && body.data.result).toBe("present");
}

async function outboxRow(eventId: string) {
  return testEnv.DB.prepare(
    "SELECT id, status, attempts, next_attempt_at FROM outbox WHERE event_id = ?",
  )
    .bind(eventId)
    .first<{ id: string; status: string; attempts: number; next_attempt_at: number }>();
}

describe("processOutbox", () => {
  it("leaves items pending when the event has no destination", async () => {
    const s = await setup();
    await scanOnce(s.cookie, s.eventId, s.qr);

    const result = await processOutbox(testEnv, {
      now: TEST_NOW,
      gateway: new FakeGateway(),
    });

    expect(result.processed).toBe(0);
    expect((await outboxRow(s.eventId))?.status).toBe("pending");
  });

  it("writes one deterministic row and marks the item done", async () => {
    const s = await setup();
    await enableSync(s.eventId);
    await scanOnce(s.cookie, s.eventId, s.qr);

    const gateway = new FakeGateway();
    const result = await processOutbox(testEnv, {
      now: TEST_NOW,
      gateway,
    });

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0, dead: 0 });

    const row = await outboxRow(s.eventId);
    expect(row?.status).toBe("done");

    const mapping = await testEnv.DB.prepare(
      "SELECT row_index FROM sheet_rows WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ row_index: number }>();
    expect(mapping?.row_index).toBe(3);

    expect(gateway.writes).toHaveLength(1);
    expect(gateway.writes[0]?.rows[0]?.values[2]).toBe("Budi Sync");
    expect(gateway.writes[0]?.rows[0]?.values[4]).toBe("present");
  });

  it("retries the same row after a transient failure", async () => {
    const s = await setup();
    await enableSync(s.eventId);
    await scanOnce(s.cookie, s.eventId, s.qr);

    const failing = new FakeGateway();
    failing.failure = { status: 500, reason: "backendError" };

    const first = await processOutbox(testEnv, {
      now: TEST_NOW,
      gateway: failing,
      random: () => 0,
    });
    expect(first.failed).toBe(1);

    const failedRow = await outboxRow(s.eventId);
    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.attempts).toBe(1);
    expect(failedRow?.next_attempt_at).toBeGreaterThan(TEST_NOW);

    // Not due yet: no second attempt.
    const early = await processOutbox(testEnv, {
      now: TEST_NOW + 1,
      gateway: new FakeGateway(),
    });
    expect(early.processed).toBe(0);

    const retryAt = failedRow?.next_attempt_at as number;
    const gateway = new FakeGateway();
    const second = await processOutbox(testEnv, {
      now: retryAt,
      gateway,
    });

    expect(second.succeeded).toBe(1);
    expect((await outboxRow(s.eventId))?.status).toBe("done");
    expect(gateway.writes[0]?.rows[0]?.rowIndex).toBe(3);

    const rows = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM sheet_rows WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("marks permanent Google errors dead instead of retrying forever", async () => {
    const s = await setup();
    await enableSync(s.eventId);
    await scanOnce(s.cookie, s.eventId, s.qr);

    const gateway = new FakeGateway();
    gateway.failure = { status: 404, reason: "notFound" };

    const result = await processOutbox(testEnv, {
      now: TEST_NOW,
      gateway,
      random: () => 0,
    });

    expect(result.dead).toBe(1);
    const row = await outboxRow(s.eventId);
    expect(row?.status).toBe("dead");
    expect(row?.attempts).toBe(1);
  });

  it("never loses attendance when Sheets fails", async () => {
    const s = await setup();
    await enableSync(s.eventId);
    await scanOnce(s.cookie, s.eventId, s.qr);

    const gateway = new FakeGateway();
    gateway.failure = { status: 500 };

    await processOutbox(testEnv, { now: TEST_NOW, gateway });

    const attendance = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM attendance WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ n: number }>();
    expect(attendance?.n).toBe(1);
  });

  it("processes only the requested event", async () => {
    const a = await setup();
    const b = await setup();
    await enableSync(a.eventId);
    await enableSync(b.eventId);
    await scanOnce(a.cookie, a.eventId, a.qr);
    await scanOnce(b.cookie, b.eventId, b.qr);

    const result = await processOutbox(testEnv, {
      now: TEST_NOW,
      eventId: a.eventId,
      gateway: new FakeGateway(),
    });

    expect(result.processed).toBe(1);
    expect((await outboxRow(a.eventId))?.status).toBe("done");
    expect((await outboxRow(b.eventId))?.status).toBe("pending");
  });
});
