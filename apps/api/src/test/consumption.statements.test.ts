import { describe, expect, it } from "vitest";

import { handleRequest } from "../app";
import type { Env } from "../env";
import { testEnv } from "./env";
import {
  addMembership,
  allowThemeDefault,
  createActivity,
  createCategory,
  createEvent,
  createParticipant,
  createSession,
  createUser,
  issueParticipantQr,
} from "./fixtures";
import { TEST_NOW, TEST_ORIGIN } from "./http";

/**
 * D1 statement budget for Q7 (NFR-011, `docs/DESAIN_API.md` §7).
 *
 * Free-tier Workers allow 50 statements per invocation. This counts what the
 * Worker actually prepares, so a regression that adds a query to the hot scan
 * path fails here instead of in production.
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

async function call(
  env: Env,
  method: "GET" | "POST" | "PUT",
  path: string,
  cookie: string,
  body?: unknown,
) {
  const headers = new Headers({ cookie });
  if (method !== "GET") {
    headers.set("content-type", "application/json");
    headers.set("x-absensi-csrf", "1");
    headers.set("origin", TEST_ORIGIN);
  }

  const request = new Request(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return handleRequest(request, env, { now: () => TEST_NOW });
}

async function world() {
  const adminId = await createUser({ role: "event_admin", displayName: "Admin Budget Q7" });
  const eventId = await createEvent({ createdBy: adminId, name: "Acara Budget Q7" });
  await testEnv.DB.prepare("UPDATE events SET status = 'active', allow_manual = 1 WHERE id = ?")
    .bind(eventId)
    .run();
  await addMembership(eventId, adminId, "event_admin");

  const activityId = await createActivity(eventId, {
    name: "Konsumsi",
    transactionType: "consumption",
    quota: 5,
  });
  await allowThemeDefault(eventId);
  const adminCookie = (await createSession(adminId)).cookie;

  const participant = await createParticipant(eventId, { fullName: "Peserta Budget" });
  const qr = await issueParticipantQr(eventId, participant.id);

  const manualParticipant = await createParticipant(eventId, {
    fullName: "Peserta Manual Budget",
  });

  const categories: string[] = [];
  for (let index = 0; index < 15; index += 1) {
    const category = await createCategory(eventId, { name: `Kelas ${index}` });
    categories.push(category.id);
  }

  return {
    adminId,
    eventId,
    activityId,
    adminCookie,
    participantId: participant.id,
    qr,
    manualParticipantId: manualParticipant.id,
    categories,
  };
}

describe("Q7 statement budget", () => {
  it("keeps quota read/write, consumption scan, manual entry, and bulk upsert under 50", async () => {
    const w = await world();
    const counter: Counter = { statements: 0 };
    const env: Env = { ...testEnv, DB: countingDb(testEnv.DB, counter) };
    const quotaPath = `/api/events/${w.eventId}/activities/${w.activityId}/quota`;

    const read = await call(env, "GET", quotaPath, w.adminCookie);
    const readStatements = counter.statements;
    expect(read.status).toBe(200);

    counter.statements = 0;
    const put = await call(env, "PUT", quotaPath, w.adminCookie, { quota: 5 });
    const putStatements = counter.statements;
    expect(put.status).toBe(200);

    counter.statements = 0;
    const scan = await call(env, "POST", `/api/events/${w.eventId}/scan`, w.adminCookie, {
      qr: w.qr,
      activityId: w.activityId,
    });
    const scanStatements = counter.statements;
    expect(scan.status).toBe(200);

    counter.statements = 0;
    const manual = await call(
      env,
      "POST",
      `/api/events/${w.eventId}/consumption/manual`,
      w.adminCookie,
      { participantId: w.manualParticipantId, activityId: w.activityId },
    );
    const manualStatements = counter.statements;
    expect(manual.status).toBe(201);

    counter.statements = 0;
    const bulk = await call(
      env,
      "PUT",
      `${quotaPath}/categories`,
      w.adminCookie,
      { rules: w.categories.map((categoryId) => ({ categoryId, quota: 1 })) },
    );
    const bulkStatements = counter.statements;
    expect(bulk.status).toBe(200);

    console.log(
      `Q7 statements: read=${readStatements}, put=${putStatements}, ` +
        `scan=${scanStatements}, manual=${manualStatements}, ` +
        `bulk15=${bulkStatements} (limit 50)`,
    );

    // Measured on 15 November 2026. The assertion fails if a regression adds a
    // query to any Q7 path, while staying far below the 50-statement limit.
    expect(readStatements).toBeLessThanOrEqual(8);
    expect(putStatements).toBeLessThanOrEqual(8);
    expect(scanStatements).toBeLessThanOrEqual(17);
    expect(manualStatements).toBeLessThanOrEqual(16);
    expect(bulkStatements).toBeLessThanOrEqual(40);
  });
});
