import type { QrLabelPayload } from "@absensi/shared";
import { QR_LABEL_BATCH_MAX } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { handleRequest } from "../app";
import type { Env } from "../env";
import { testEnv } from "./env";
import { createEvent, createParticipant, createSession, createUser } from "./fixtures";
import { TEST_NOW, TEST_ORIGIN } from "./http";

/**
 * Free-tier statement budget for a full label page (AGENTS.md).
 *
 * Every `prepare()` and every statement inside `batch()` counts toward D1's
 * 50-statement-per-invocation limit, so this test counts what the Worker
 * actually sends rather than trusting a comment. The page is 40 because 40
 * inserts plus auth/read/audit leaves headroom; a regression that adds one
 * query per label fails here.
 */

interface Counter {
  statements: number;
}

/**
 * Wraps only `prepare` and `batch`; every other binding method is forwarded
 * bound to the real object so D1's host-object brand checks still pass.
 *
 * A statement is counted once, at `prepare()`: `prepare` is where the worker
 * compiles it, and every statement in this path is executed exactly once. A
 * batched statement was prepared through this same wrapper, so `batch()` adds
 * nothing — counting both would report 40 inserts as 80.
 */
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

      if (prop === "batch") {
        return (statements: D1PreparedStatement[]) => target.batch(statements);
      }

      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
}

async function printPage(env: Env, eventId: string, cookie: string): Promise<QrLabelPayload> {
  const request = new Request(`${TEST_ORIGIN}/api/events/${eventId}/participants/qr-labels`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-absensi-csrf": "1",
      origin: TEST_ORIGIN,
      cookie,
    },
    body: JSON.stringify({ limit: QR_LABEL_BATCH_MAX }),
  });

  const response = await handleRequest(request, env, { now: () => TEST_NOW });
  expect(response.status).toBe(200);

  const body = (await response.json()) as { ok: boolean; data?: QrLabelPayload };
  if (!body.ok || !body.data) throw new Error("expected a label page");
  return body.data;
}

describe("qr-labels statement budget", () => {
  it("stays within the D1 50-statement limit for a full page", async () => {
    const userId = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: userId, name: "Acara Budget" });
    const session = await createSession(userId);

    for (let i = 0; i < QR_LABEL_BATCH_MAX; i += 1) {
      await createParticipant(eventId, { fullName: `Peserta ${i}`, category: "Kelas 7" });
    }

    const counter: Counter = { statements: 0 };
    const env: Env = { ...testEnv, DB: countingDb(testEnv.DB, counter) };

    const issued = await printPage(env, eventId, session.cookie);
    const issuanceStatements = counter.statements;
    expect(issued.labels).toHaveLength(QR_LABEL_BATCH_MAX);

    // Reprint: same page, credentials already exist, so only reads.
    counter.statements = 0;
    const reprinted = await printPage(env, eventId, session.cookie);
    const reprintStatements = counter.statements;
    expect(reprinted.labels).toHaveLength(QR_LABEL_BATCH_MAX);

    console.log(
      `qr labels ${QR_LABEL_BATCH_MAX}: issue=${issuanceStatements} statements, ` +
        `reprint=${reprintStatements} statements (limit 50)`,
    );

    expect(issuanceStatements).toBeLessThanOrEqual(50);
    expect(reprintStatements).toBeLessThanOrEqual(50);
  });
});
