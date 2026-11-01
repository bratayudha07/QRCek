import type {
  ImportPreviewPayload,
  ImportResultPayload,
  ParticipantListPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  addMembership,
  countRows,
  createEvent,
  createSession,
  createUser,
} from "./fixtures";
import { callApi, errorCode } from "./http";
import { TEST_NOW } from "./http";

interface World {
  superadmin: { id: string; cookie: string };
  eventA: string;
  eventB: string;
  adminA: { id: string; cookie: string };
  officerA: { id: string; cookie: string };
  adminB: { id: string; cookie: string };
}

async function world(): Promise<World> {
  const superadminId = await createUser({ role: "superadmin" });
  const eventA = await createEvent({ createdBy: superadminId, name: "Acara A" });
  const eventB = await createEvent({ createdBy: superadminId, name: "Acara B" });

  const adminAId = await createUser({ role: "event_admin", displayName: "Admin A" });
  await addMembership(eventA, adminAId, "event_admin");

  const officerAId = await createUser({ role: "officer", displayName: "Petugas A" });
  await addMembership(eventA, officerAId, "officer");

  const adminBId = await createUser({ role: "event_admin", displayName: "Admin B" });
  await addMembership(eventB, adminBId, "event_admin");

  return {
    superadmin: { id: superadminId, cookie: (await createSession(superadminId)).cookie },
    eventA,
    eventB,
    adminA: { id: adminAId, cookie: (await createSession(adminAId)).cookie },
    officerA: { id: officerAId, cookie: (await createSession(officerAId)).cookie },
    adminB: { id: adminBId, cookie: (await createSession(adminBId)).cookie },
  };
}

const HEADER = "external_ref,full_name,phone,email,category,note";

async function importCsv(
  eventId: string,
  cookie: string,
  csv: string,
  options: { confirm?: boolean; json?: boolean } = {},
) {
  const query = options.confirm ? "?dry_run=false" : "";

  return callApi(`/api/events/${eventId}/participants/import${query}`, {
    cookie,
    method: "POST",
    ...(options.json ? { body: { csv } } : { rawBody: csv }),
  });
}

describe("POST /api/events/:id/participants/import", () => {
  it("defaults to preview and writes nothing", async () => {
    const w = await world();
    const csv = `${HEADER}\nNIS-1,Budi,081234567890,,Kelas 5A,\nNIS-2,Siti,,siti@example.com,,`;

    const response = await importCsv(w.eventA, w.adminA.cookie, csv);

    expect(response.status).toBe(200);
    const body = response.json<ImportPreviewPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data).toMatchObject({
      dryRun: true,
      total: 2,
      valid: 2,
      created: 2,
      updated: 0,
      invalid: [],
    });
    expect(body.data.sample[0]).toMatchObject({ fullName: "Budi", action: "create" });
    expect(await countRows("participants")).toBe(0);
  });

  it("creates rows only after an explicit confirm and is idempotent", async () => {
    const w = await world();
    const csv = `${HEADER}\nNIS-1,Budi,081234567890,,Kelas 5A,`;

    const confirmed = await importCsv(w.eventA, w.adminA.cookie, csv, { confirm: true });
    expect(confirmed.status).toBe(200);

    const body = confirmed.json<ImportResultPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data).toMatchObject({ dryRun: false, created: 1, updated: 0, skipped: 0 });
    expect(await countRows("participants")).toBe(1);

    const reimport = await importCsv(
      w.eventA,
      w.adminA.cookie,
      `${HEADER}\nNIS-1,Budi Santoso,081234567890,,Kelas 6A,`,
      { confirm: true },
    );

    const reimportBody = reimport.json<ImportResultPayload>();
    if (!reimportBody.ok) throw new Error("expected success");
    expect(reimportBody.data).toMatchObject({ created: 0, updated: 1 });
    expect(await countRows("participants")).toBe(1);

    const list = await callApi(`/api/events/${w.eventA}/participants?status=all`, {
      cookie: w.adminA.cookie,
    });
    const listBody = list.json<ParticipantListPayload>();
    if (!listBody.ok) throw new Error("expected success");
    expect(listBody.data.items[0]).toMatchObject({
      externalRef: "NIS-1",
      fullName: "Budi Santoso",
      category: "Kelas 6A",
    });
  });

  it("previews existing refs as updates", async () => {
    const w = await world();
    const csv = `${HEADER}\nNIS-1,Budi,,,,`;

    await importCsv(w.eventA, w.adminA.cookie, csv, { confirm: true });
    const preview = await importCsv(w.eventA, w.adminA.cookie, csv);

    const body = preview.json<ImportPreviewPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data).toMatchObject({ created: 0, updated: 1 });
    expect(body.data.sample[0]?.action).toBe("update");
  });

  it("saves valid rows and reports invalid rows with physical line numbers", async () => {
    const w = await world();
    const csv = [
      HEADER,
      "NIS-1,Budi,081234567890,,,",
      "NIS-2,,081234567890,,,", // line 3: missing full_name
      "NIS-3,Siti,abc,,,", // line 4: invalid phone
      "NIS-4,Agus,,,,", // line 5: valid
      "NIS-1,Duplikat,,,,", // line 6: duplicate ref
    ].join("\n");

    const preview = await importCsv(w.eventA, w.adminA.cookie, csv);
    const previewBody = preview.json<ImportPreviewPayload>();
    if (!previewBody.ok) throw new Error("expected success");

    expect(previewBody.data).toMatchObject({ total: 5, valid: 2 });
    expect(previewBody.data.invalid.map((row) => row.line)).toEqual([3, 4, 6]);

    const confirmed = await importCsv(w.eventA, w.adminA.cookie, csv, { confirm: true });
    const confirmedBody = confirmed.json<ImportResultPayload>();
    if (!confirmedBody.ok) throw new Error("expected success");
    expect(confirmedBody.data).toMatchObject({ created: 2, updated: 0, skipped: 3 });
    expect(await countRows("participants")).toBe(2);
  });

  it("rejects a file without the full_name header", async () => {
    const w = await world();

    const response = await importCsv(w.eventA, w.adminA.cookie, "external_ref,phone\nNIS-1,0812");

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate and unknown headers", async () => {
    const w = await world();

    const duplicate = await importCsv(
      w.eventA,
      w.adminA.cookie,
      "full_name,full_name\nBudi,Budi",
    );
    expect(duplicate.status).toBe(400);

    const unknown = await importCsv(w.eventA, w.adminA.cookie, "full_name,nis\nBudi,1");
    expect(unknown.status).toBe(400);
  });

  it("accepts a semicolon delimiter, quotes, and embedded newlines", async () => {
    const w = await world();
    const csv = [
      "external_ref;full_name;note",
      'NIS-1;"Budi, S.Pd";"baris satu',
      'baris dua"',
    ].join("\n");

    const response = await importCsv(w.eventA, w.adminA.cookie, csv, { confirm: true });
    expect(response.status).toBe(200);

    const list = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
    });
    const body = list.json<ParticipantListPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.items[0]).toMatchObject({
      fullName: "Budi, S.Pd",
      note: "baris satu\nbaris dua",
    });
  });

  it("accepts a JSON envelope with a csv field", async () => {
    const w = await world();

    const response = await importCsv(w.eventA, w.adminA.cookie, `${HEADER}\nNIS-1,Budi,,,,`, {
      confirm: true,
      json: true,
    });

    expect(response.status).toBe(200);
  });

  it("rejects more than 1,000 data rows with 413", async () => {
    const w = await world();
    const lines = [HEADER];
    for (let i = 0; i < 1_001; i += 1) lines.push(`NIS-${i},Peserta ${i},,,,`);

    const response = await importCsv(w.eventA, w.adminA.cookie, lines.join("\n"));

    expect(response.status).toBe(413);
    expect(errorCode(response)).toBe("PAYLOAD_TOO_LARGE");
    expect(response.body.ok ? "" : response.body.error.message).toMatch(/1\.000|1000/);
  });

  it("rejects a body larger than 2 MB", async () => {
    const w = await world();
    const csv = `${HEADER}\nNIS-1,${"a".repeat(2 * 1024 * 1024)},,,,`;

    const response = await importCsv(w.eventA, w.adminA.cookie, csv);

    expect(response.status).toBe(413);
  });

  it("returns 403 for an officer", async () => {
    const w = await world();

    const response = await importCsv(w.eventA, w.officerA.cookie, `${HEADER}\nNIS-1,Budi,,,,`);

    expect(response.status).toBe(403);
  });

  it("returns 404 for an admin of another event", async () => {
    const w = await world();

    const response = await importCsv(w.eventA, w.adminB.cookie, `${HEADER}\nNIS-1,Budi,,,,`);

    expect(response.status).toBe(404);
  });

  it("refuses to import into an archived event", async () => {
    const w = await world();

    for (const status of ["active", "closed", "archived"] as const) {
      await callApi(`/api/events/${w.eventA}/status`, {
        cookie: w.adminA.cookie,
        body: { status },
      });
    }

    const response = await importCsv(w.eventA, w.adminA.cookie, `${HEADER}\nNIS-1,Budi,,,,`, {
      confirm: true,
    });

    expect(response.status).toBe(422);
    expect(await countRows("participants")).toBe(0);
  });

  it("does not leak rows across events", async () => {
    const w = await world();

    await importCsv(w.eventA, w.adminA.cookie, `${HEADER}\nNIS-1,Budi,,,,`, { confirm: true });

    const listB = await callApi(`/api/events/${w.eventB}/participants?status=all`, {
      cookie: w.adminB.cookie,
    });
    const listBBody = listB.json<ParticipantListPayload>();
    if (!listBBody.ok) throw new Error("expected success");

    expect(listBBody.data.items).toEqual([]);
  });

  it("rate-limits repeated confirms per event", async () => {
    const w = await world();
    const csv = `${HEADER}\nNIS-1,Budi,,,,`;

    for (let i = 0; i < 10; i += 1) {
      const response = await importCsv(w.eventA, w.adminA.cookie, csv, { confirm: true });
      expect(response.status).toBe(200);
    }

    const limited = await importCsv(w.eventA, w.adminA.cookie, csv, { confirm: true });

    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe("RATE_LIMITED");
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });

  it("uses the injected clock for created_at/updated_at", async () => {
    const w = await world();

    await importCsv(w.eventA, w.adminA.cookie, `${HEADER}\nNIS-1,Budi,,,,`, { confirm: true });
    const list = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
    });
    const body = list.json<ParticipantListPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.items[0]?.createdAt).toBe(TEST_NOW);
  });
});
