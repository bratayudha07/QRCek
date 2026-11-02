import { describe, expect, it } from "vitest";

import { claimInvite, releaseInviteClaim, setInviteUsedByStatement } from "../db/invites";
import { claimRecoveryCode, releaseRecoveryCodeClaim } from "../db/recovery";
import { createEvent, createSession, createUser, seedInvite } from "./fixtures";
import { testEnv } from "./env";
import { TEST_NOW } from "./http";

/**
 * Claim compensation for `activate` / `recover`.
 *
 * The claim is committed before the write batch (fast replay rejection), so a
 * failed batch would otherwise burn the invite or the user's only recovery
 * code. These tests exercise the safety property directly: releasing must only
 * undo a claim that never produced an account.
 */

async function inviteRow(inviteId: string) {
  return testEnv.DB.prepare("SELECT used_at, used_by FROM invites WHERE id = ?")
    .bind(inviteId)
    .first<{ used_at: number | null; used_by: string | null }>();
}

describe("invite claim compensation", () => {
  it("lets the same invite be claimed again after a failed activation", async () => {
    const creator = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: creator });
    const invite = await seedInvite({ role: "officer", eventId });

    expect(await claimInvite(testEnv.DB, invite.inviteId, TEST_NOW)).toBe(1);
    expect(await releaseInviteClaim(testEnv.DB, invite.inviteId)).toBe(1);
    expect((await inviteRow(invite.inviteId))?.used_at).toBeNull();
    expect(await claimInvite(testEnv.DB, invite.inviteId, TEST_NOW)).toBe(1);
  });

  it("never reopens an invite that already produced an account", async () => {
    const creator = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: creator });
    const invite = await seedInvite({ role: "officer", eventId });
    const userId = await createUser({ role: "officer" });

    await claimInvite(testEnv.DB, invite.inviteId, TEST_NOW);
    await setInviteUsedByStatement(testEnv.DB, invite.inviteId, userId).run();

    expect(await releaseInviteClaim(testEnv.DB, invite.inviteId)).toBe(0);

    const row = await inviteRow(invite.inviteId);
    expect(row?.used_at).toBe(TEST_NOW);
    expect(row?.used_by).toBe(userId);
  });
});

describe("recovery code claim compensation", () => {
  async function seedRecoveryCode(userId: string): Promise<string> {
    await testEnv.DB.prepare(
      "INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind("recovery-uji", userId, "hash-uji", TEST_NOW)
      .run();

    return "recovery-uji";
  }

  it("lets the user retry a code whose session batch failed", async () => {
    const userId = await createUser({ role: "officer" });
    const codeId = await seedRecoveryCode(userId);

    expect(await claimRecoveryCode(testEnv.DB, codeId, TEST_NOW)).toBe(1);
    expect(await releaseRecoveryCodeClaim(testEnv.DB, codeId, "sesi-tidak-ada")).toBe(1);
    expect(await claimRecoveryCode(testEnv.DB, codeId, TEST_NOW)).toBe(1);
  });

  it("never frees a code whose new session was actually committed", async () => {
    const userId = await createUser({ role: "officer" });
    const codeId = await seedRecoveryCode(userId);
    const session = await createSession(userId);

    await claimRecoveryCode(testEnv.DB, codeId, TEST_NOW);

    expect(await releaseRecoveryCodeClaim(testEnv.DB, codeId, session.sessionId)).toBe(0);

    const row = await testEnv.DB.prepare("SELECT used_at FROM recovery_codes WHERE id = ?")
      .bind(codeId)
      .first<{ used_at: number | null }>();
    expect(row?.used_at).toBe(TEST_NOW);
  });
});
