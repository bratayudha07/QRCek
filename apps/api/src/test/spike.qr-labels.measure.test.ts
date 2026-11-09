import type { QrLabelPayload } from "@absensi/shared";
import { QR_LABEL_BATCH_MAX } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  issueQrCredential,
  qrKeyConfig,
  readQrCredentialToken,
} from "../domain/qr-token";
import { createEvent, createParticipant, createSession, createUser } from "./fixtures";
import { callApi } from "./http";
import { testEnv } from "./env";

/**
 * Spike: cost proxy for a full label page and for the crypto behind it.
 *
 * Like `spike.measure.test.ts`, this measures wall clock inside local workerd,
 * not the platform's billed CPU time. The page batch is the shared limit (40);
 * the crypto block still issues 100 credentials so the measurement that
 * justified lowering the limit stays reproducible.
 */

const BATCH = QR_LABEL_BATCH_MAX;
const CRYPTO_BATCH = 100;
const RUNS = 8;

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

describe("spike: QR label page", () => {
  it(`measures issuance and reprint of ${BATCH} labels`, async () => {
    const userId = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: userId, name: "Acara Spike" });
    const session = await createSession(userId);

    for (let i = 0; i < BATCH; i += 1) {
      await createParticipant(eventId, {
        fullName: `Peserta ${i}`,
        externalRef: `SPIKE-${i}`,
        category: "Kelas 7",
      });
    }

    const path = `/api/events/${eventId}/participants/qr-labels`;
    const samples: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      const start = performance.now();
      const response = await callApi(path, {
        method: "POST",
        cookie: session.cookie,
        body: { limit: BATCH },
      });
      const elapsed = performance.now() - start;

      expect(response.status).toBe(200);
      const payload = response.json<QrLabelPayload>();
      if (!payload.ok) throw new Error("expected success");
      expect(payload.data.labels).toHaveLength(BATCH);

      samples.push(elapsed);
    }

    const issuance = samples[0] ?? 0;
    const reprints = samples.slice(1);

    console.log(
      `qr labels ${BATCH}: first(issue)=${issuance.toFixed(2)}ms ` +
        `reprint p50=${percentile(reprints, 50).toFixed(2)}ms ` +
        `p95=${percentile(reprints, 95).toFixed(2)}ms ` +
        `max=${Math.max(...reprints).toFixed(2)}ms`,
    );

    expect(samples).toHaveLength(RUNS);
  });

  it("measures the crypto-only cost of 100 credentials (limit rationale)", async () => {
    const config = await qrKeyConfig(testEnv);
    const rounds = 5;
    const issue: number[] = [];
    const read: number[] = [];

    for (let round = 0; round < rounds; round += 1) {
      const issueStart = performance.now();
      const issued = [];
      for (let i = 0; i < CRYPTO_BATCH; i += 1) issued.push(await issueQrCredential(config));
      issue.push(performance.now() - issueStart);

      const readStart = performance.now();
      for (const { credential } of issued) {
        await readQrCredentialToken(config, credential);
      }
      read.push(performance.now() - readStart);
    }

    console.log(
      `qr crypto 100 issue: p50=${percentile(issue, 50).toFixed(2)}ms ` +
        `p95=${percentile(issue, 95).toFixed(2)}ms | ` +
        `100 read: p50=${percentile(read, 50).toFixed(2)}ms ` +
        `p95=${percentile(read, 95).toFixed(2)}ms`,
    );

    // Keep the assertions explicit so a future refactor cannot silently skip a
    // measurement round.
    expect(issue).toHaveLength(rounds);
    expect(read).toHaveLength(rounds);
  });
});
