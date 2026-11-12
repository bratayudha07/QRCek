import { describe, expect, it } from "vitest";

import {
  adjustmentDiff,
  contextShapeError,
  lifecycleRejection,
  scanMessage,
  transactionSnapshot,
} from "./transactions";

/**
 * Pure Q5 decision tables (ADR-0018/0020/0022).
 *
 * These tests need no D1 or clock: the route only supplies a row and a moment,
 * so the lifecycle/result mapping can be pinned here.
 */

const open = {
  event: { status: "active" as const, starts_at: null, ends_at: null },
  activity: { status: "active", archived_at: null },
  session: null,
  participant: { status: "active" as const },
  now: 1_760_000_000_000,
};

describe("lifecycleRejection", () => {
  it("accepts an open Tema, active Aktivitas, and active participant", () => {
    expect(lifecycleRejection(open)).toBeNull();
  });

  it("maps Tema state and window to theme_not_active", () => {
    expect(lifecycleRejection({ ...open, event: { ...open.event, status: "draft" } })).toBe(
      "theme_not_active",
    );
    expect(lifecycleRejection({ ...open, event: { ...open.event, status: "closed" } })).toBe(
      "theme_not_active",
    );
    expect(
      lifecycleRejection({ ...open, event: { ...open.event, status: "archived" } }),
    ).toBe("theme_archived");
    expect(
      lifecycleRejection({ ...open, event: { ...open.event, starts_at: open.now + 1 } }),
    ).toBe("theme_not_active");
    expect(
      lifecycleRejection({ ...open, event: { ...open.event, ends_at: open.now - 1 } }),
    ).toBe("theme_not_active");
  });

  it("checks the participant, Aktivitas, and Sesi in order", () => {
    expect(
      lifecycleRejection({ ...open, participant: { status: "inactive" } }),
    ).toBe("participant_inactive");
    expect(
      lifecycleRejection({ ...open, activity: { status: "draft", archived_at: null } }),
    ).toBe("activity_not_active");
    expect(
      lifecycleRejection({
        ...open,
        activity: { status: "completed", archived_at: 1 },
      }),
    ).toBe("activity_archived");
    expect(
      lifecycleRejection({
        ...open,
        session: { status: "completed", archived_at: null },
      }),
    ).toBe("session_not_in_progress");
    expect(
      lifecycleRejection({
        ...open,
        session: { status: "in_progress", archived_at: 1 },
      }),
    ).toBe("session_archived");
  });
});

describe("contextShapeError", () => {
  it("requires a Sesi exactly when the Aktivitas owns one", () => {
    expect(
      contextShapeError({
        activityType: "attendance",
        activityHasSessions: true,
        requestedSessionId: null,
      }),
    ).toBe("session_required");
    expect(
      contextShapeError({
        activityType: "attendance",
        activityHasSessions: false,
        requestedSessionId: "01S",
      }),
    ).toBe("context_mismatch");
    expect(
      contextShapeError({
        activityType: "consumption",
        activityHasSessions: false,
        requestedSessionId: null,
      }),
    ).toBe("context_mismatch");
    expect(
      contextShapeError({
        activityType: "attendance",
        activityHasSessions: true,
        requestedSessionId: "01S",
      }),
    ).toBeNull();
  });
});

describe("adjustmentDiff", () => {
  it("records only changed allowlisted fields", () => {
    const diff = adjustmentDiff(
      { occurredAt: 1, note: null, status: "present" },
      { occurredAt: 2, note: null, status: "present" },
    );

    expect(diff.changed).toBe(true);
    expect(diff.before).toEqual({ occurredAt: 1 });
    expect(diff.after).toEqual({ occurredAt: 2 });
  });

  it("never puts note text into the diff", () => {
    const diff = adjustmentDiff(
      { occurredAt: 1, note: null, status: "present" },
      { occurredAt: 1, note: "rahasia", status: "present" },
    );

    expect(diff.before).toEqual({ noteChanged: true });
    expect(diff.after).toEqual({ noteChanged: true });
    expect(JSON.stringify(diff)).not.toContain("rahasia");
  });

  it("reports no change when every value is identical", () => {
    expect(
      adjustmentDiff(
        { occurredAt: 1, note: "sama", status: "late" },
        { occurredAt: 1, note: "sama", status: "late" },
      ).changed,
    ).toBe(false);
  });
});

describe("transactionSnapshot", () => {
  it("carries context and correction markers, not free text", () => {
    const snapshot = transactionSnapshot(
      {
        id: "01T",
        theme_id: "01E",
        activity_id: "01A",
        session_id: null,
        participant_id: "01P",
        type: "attendance",
        source: "manual",
        status: "excused",
        occurred_at: 5,
        adjusts_transaction_id: null,
        reversed_at: null,
        superseded_at: null,
      },
      { noteChanged: true },
    );

    expect(snapshot).toEqual({
      themeId: "01E",
      activityId: "01A",
      sessionId: null,
      participantId: "01P",
      type: "attendance",
      source: "manual",
      status: "excused",
      occurredAt: 5,
      noteChanged: true,
      adjustsTransactionId: null,
      reversedAt: null,
      supersededAt: null,
    });
  });
});

describe("scanMessage", () => {
  it("returns a user-facing message for every reason and success", () => {
    expect(scanMessage(null)).toBe("Kehadiran tercatat");
    expect(scanMessage("duplicate")).toBe("Sudah tercatat hadir");
    expect(scanMessage("entitlement_denied")).toContain("tidak berhak");
    expect(scanMessage("session_required")).toBe("Sesi belum dipilih");
  });
});
