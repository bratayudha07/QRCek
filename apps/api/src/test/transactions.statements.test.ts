import { describe, expect, it } from "vitest";

import { handleRequest } from "../app";
import type { Env } from "../env";
import { testEnv } from "./env";
import {
  addMembership,
  allowThemeDefault,
  createActivity,
  createEvent,
  createParticipant,
  createSession,
  createUser,
  issueParticipantQr,
} from "./fixtures";
import { TEST_NOW, TEST_ORIGIN } from "./http";

/**
 * D1 statement budget for Q5 (NFR-011, `docs/DESAIN_API.md` §7).
 *
 * Free-tier Workers allow 50 statements per invocation. The route comments claim
 * ≤ 10 for a scan and a correction; this test counts what the Worker actually
 * prepares instead of trusting the comment.
 */

interface Counter {
  statements: number;
}

function countingDb(db: D1Database, counter: Counter): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);

      if (prop === "prepare") {
        return (sql: string) => {
          counter.statements += 1;
          return target.prepare(sql);
        };
      }

      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
}

async function post(env: Env, path: string, body: unknown, cookie: string) {
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-absensi-csrf": "1",
      origin: TEST_ORIGIN,
      cookie,
    },
    body: JSON.stringify(body),
  });

  return handleRequest(request, env, { now: () => TEST_NOW });
}

async function scanBody(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    data?: { transaction?: { id: string } };
  };
}

async function world() {
  const adminId = await createUser({ role: "event_admin", displayName: "Admin Budget" });
  const eventId = await createEvent({ createdBy: adminId, name: "Acara Budget Q5" });
  await testEnv.DB.prepare(
    "UPDATE events SET status = 'active', allow_manual = 1 WHERE id = ?",
  )
    .bind(eventId)
    .run();
  await addMembership(eventId, adminId, "event_admin");

  const activityId = await createActivity(eventId);
  await allowThemeDefault(eventId);
  const adminCookie = (await createSession(adminId)).cookie;

  const participant = await createParticipant(eventId, { fullName: "Peserta Budget" });
  const qr = await issueParticipantQr(eventId, participant.id);

  return { adminId, eventId, activityId, adminCookie, participantId: participant.id, qr };
}

describe("Q5 statement budget", () => {
  it("stays at or below 10 statements for scan, reversal, adjustment, and manual", async () => {
    const w = await world();
    const counter: Counter = { statements: 0 };
    const env: Env = { ...testEnv, DB: countingDb(testEnv.DB, counter) };

    const scanResponse = await post(
      env,
      `/api/events/${w.eventId}/scan`,
      { qr: w.qr, activityId: w.activityId },
      w.adminCookie,
    );
    const scanStatements = counter.statements;
    expect(scanResponse.status).toBe(200);
    const transactionId = (await scanBody(scanResponse)).data?.transaction?.id as string;

    counter.statements = 0;
    const reversal = await post(
      env,
      `/api/events/${w.eventId}/transactions/${transactionId}/reversal`,
      { reason: "Salah pindai kartu" },
      w.adminCookie,
    );
    const reversalStatements = counter.statements;
    expect(reversal.status).toBe(200);

    counter.statements = 0;
    const manualParticipant = await createParticipant(w.eventId, { fullName: "Peserta Manual" });
    const manual = await post(
      env,
      `/api/events/${w.eventId}/attendance/manual`,
      {
        participantId: manualParticipant.id,
        activityId: w.activityId,
        status: "excused",
        note: "Surat izin",
      },
      w.adminCookie,
    );
    const manualStatements = counter.statements;
    expect(manual.status).toBe(201);
    const manualBody = (await manual.json()) as {
      ok: boolean;
      data?: { attendance?: { id: string } };
    };
    const manualTransactionId = manualBody.data?.attendance?.id as string;

    counter.statements = 0;
    const adjustment = await post(
      env,
      `/api/events/${w.eventId}/transactions/${manualTransactionId}/adjustment`,
      { status: "present", reason: "Surat izin dibatalkan" },
      w.adminCookie,
    );
    const adjustmentStatements = counter.statements;
    expect(adjustment.status).toBe(200);

    console.log(
      `Q5 statements: scan=${scanStatements}, reversal=${reversalStatements}, ` +
        `manual=${manualStatements}, adjustment=${adjustmentStatements} (limit 50)`,
    );

    // Measured on 10 November 2026. The assertion fails if a regression adds a
    // query to any Q5 path, while staying far below the 50-statement limit.
    expect(scanStatements).toBeLessThanOrEqual(15);
    expect(reversalStatements).toBeLessThanOrEqual(11);
    expect(manualStatements).toBeLessThanOrEqual(13);
    expect(adjustmentStatements).toBeLessThanOrEqual(12);
  });
});
