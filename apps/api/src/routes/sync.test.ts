import type { SyncRunPayload } from "@absensi/shared";
import { SYNC_RUN_MAX } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { addMembership, createEvent, createSession, createUser } from "../test/fixtures";
import { testEnv } from "../test/env";
import { TEST_NOW, callApi, errorCode } from "../test/http";

/**
 * Manual Sheets sync (DESAIN_API.md §9, §11).
 *
 * The queue is empty in these tests, so `processOutbox` returns before it
 * builds a Google client: no test reaches the network.
 */

async function setup(): Promise<{ eventId: string; cookie: string }> {
  const adminId = await createUser({ role: "event_admin" });
  const eventId = await createEvent({ createdBy: adminId, name: "Acara Sync" });
  await addMembership(eventId, adminId, "event_admin");
  const cookie = (await createSession(adminId)).cookie;

  await testEnv.DB.prepare(
    `INSERT INTO sync_state
       (event_id, spreadsheet_id, sheet_tab, sync_enabled, schema_version, updated_at)
     VALUES (?, 'spreadsheet-uji-123', 'Absensi', 1, 1, ?)`,
  )
    .bind(eventId, TEST_NOW)
    .run();

  return { eventId, cookie };
}

describe("POST /api/events/:eventId/sync/run", () => {
  it("allows one manual run per event per minute", async () => {
    const s = await setup();

    const first = await callApi(`/api/events/${s.eventId}/sync/run`, {
      method: "POST",
      body: { limit: 5 },
      cookie: s.cookie,
    });
    expect(first.status).toBe(200);

    const second = await callApi(`/api/events/${s.eventId}/sync/run`, {
      method: "POST",
      body: { limit: 5 },
      cookie: s.cookie,
    });
    expect(second.status).toBe(429);
    expect(errorCode(second)).toBe("RATE_LIMITED");
    expect(second.headers.get("retry-after")).toBeTruthy();
  });

  it("rejects a limit above the per-invocation query budget", async () => {
    const s = await setup();

    const response = await callApi(`/api/events/${s.eventId}/sync/run`, {
      method: "POST",
      body: { limit: SYNC_RUN_MAX + 1 },
      cookie: s.cookie,
    });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("accepts the documented maximum and reports an empty queue", async () => {
    const s = await setup();

    const response = await callApi(`/api/events/${s.eventId}/sync/run`, {
      method: "POST",
      body: { limit: SYNC_RUN_MAX },
      cookie: s.cookie,
    });

    expect(response.status).toBe(200);
    const body = response.json<SyncRunPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.processed).toBe(0);
    expect(body.data.error).toBeNull();
  });

  it("refuses an officer before spending the event's rate-limit budget", async () => {
    const s = await setup();
    const officerId = await createUser({ role: "officer" });
    await addMembership(s.eventId, officerId, "officer");
    const officerCookie = (await createSession(officerId)).cookie;

    const response = await callApi(`/api/events/${s.eventId}/sync/run`, {
      method: "POST",
      body: { limit: 5 },
      cookie: officerCookie,
    });

    expect(response.status).toBe(403);

    const adminRun = await callApi(`/api/events/${s.eventId}/sync/run`, {
      method: "POST",
      body: { limit: 5 },
      cookie: s.cookie,
    });
    expect(adminRun.status).toBe(200);
  });
});
