import type { ApiResponse, ScanResultPayload, StaffContext } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_DURATION_MS,
  INITIAL_SCANNER_STATE,
  classifyScanFailure,
  classifyScanResponse,
  resolveDeepLinkContext,
  scannerIsLocked,
  scannerReducer,
  staffContextKey,
  staffContextLabel,
  type ScannerState,
} from "./scanner";

/** T-102, T-103, T-104: pure classification and the scanner state machine. */

function payload(overrides: Partial<ScanResultPayload> = {}): ScanResultPayload {
  return {
    result: "SUCCESS",
    reason: null,
    message: "Kehadiran tercatat",
    ...overrides,
  };
}

describe("classifyScanResponse", () => {
  it("reports a known SUCCESS as success", () => {
    const feedback = classifyScanResponse({
      ok: true,
      data: payload({ participant: { id: "p1", fullName: "Budi", externalRef: null, category: null } }),
    });

    expect(feedback).toMatchObject({
      tone: "success",
      kind: "success",
      icon: "check",
      role: "status",
      participantName: "Budi",
    });
  });

  it("keeps DUPLICATE as a warning with the first-scan time", () => {
    const feedback = classifyScanResponse({
      ok: true,
      data: payload({
        result: "DUPLICATE",
        reason: "duplicate",
        message: "Sudah tercatat hadir",
        transaction: {
          id: "t1",
          activityId: "a1",
          sessionId: null,
          occurredAt: 1_760_000_000_000,
          status: "present",
        },
      }),
    });

    expect(feedback.tone).toBe("warning");
    expect(feedback.occurredAt).toBe(1_760_000_000_000);
  });

  it("never reports an unknown result as success", () => {
    const unknown = {
      ok: true,
      data: { result: "OK", reason: null, message: "something" },
    } as unknown as ApiResponse<ScanResultPayload>;

    expect(classifyScanResponse(unknown)).toMatchObject({
      tone: "error",
      kind: "system",
      role: "alert",
    });
  });

  it("maps each HTTP failure code to an actionable state", () => {
    const cases: Array<[ApiResponse<ScanResultPayload>, string]> = [
      [
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Sesi berakhir" } },
        "session",
      ],
      [{ ok: false, error: { code: "FORBIDDEN", message: "Tidak ditugaskan" } }, "assignment"],
      [{ ok: false, error: { code: "NOT_FOUND", message: "Tidak ada" } }, "context"],
      [{ ok: false, error: { code: "BUSINESS_RULE", message: "Aturan" } }, "context"],
      [{ ok: false, error: { code: "RATE_LIMITED", message: "Terlalu banyak" } }, "rate_limited"],
      [{ ok: false, error: { code: "INTERNAL", message: "Internal" } }, "system"],
      [{ ok: false, error: { code: "DB_UNAVAILABLE", message: "DB" } }, "system"],
    ];

    for (const [response, kind] of cases) {
      expect(classifyScanResponse(response).kind).toBe(kind);
    }
  });

  it("treats a thrown request as a network failure, not as invalid QR", () => {
    const network = classifyScanFailure(new TypeError("Failed to fetch"));
    const invalid = classifyScanResponse({
      ok: true,
      data: payload({ result: "INVALID_QR", reason: "qr_invalid", message: "QR tidak dikenali" }),
    });

    expect(network).toMatchObject({ tone: "error", kind: "network", icon: "wifi-off" });
    expect(network.description).toContain("belum tercatat");
    expect(invalid.kind).not.toBe(network.kind);
  });
});

describe("scannerReducer", () => {
  const at = 1_000;

  it("locks while processing and shows feedback for two seconds", () => {
    let state = scannerReducer(INITIAL_SCANNER_STATE, { type: "detected", at });
    expect(state.phase).toBe("processing");
    expect(scannerIsLocked(state)).toBe(true);

    state = scannerReducer(state, {
      type: "resolved",
      at,
      feedback: { ...classifyScanFailure(null), tone: "success", kind: "success" },
    });
    expect(state.phase).toBe("feedback");
    expect(state.lockedUntil).toBe(at + FEEDBACK_DURATION_MS);

    // Too early: still locked.
    expect(scannerReducer(state, { type: "feedback_elapsed", at: at + 1 }).phase).toBe(
      "feedback",
    );

    const standby = scannerReducer(state, {
      type: "feedback_elapsed",
      at: at + FEEDBACK_DURATION_MS,
    });
    expect(standby).toEqual(INITIAL_SCANNER_STATE);
  });

  it("ignores detections while processing, showing feedback, or offline", () => {
    const processing: ScannerState = { phase: "processing", feedback: null, lockedUntil: null };
    expect(scannerReducer(processing, { type: "detected", at }).phase).toBe("processing");

    const offline: ScannerState = { phase: "offline", feedback: null, lockedUntil: null };
    expect(scannerReducer(offline, { type: "detected", at }).phase).toBe("offline");

    const feedback: ScannerState = {
      phase: "feedback",
      feedback: null,
      lockedUntil: at + 1,
    };
    expect(scannerReducer(feedback, { type: "detected", at }).phase).toBe("feedback");
  });

  it("has no offline queue: a failed request is never replayed automatically", () => {
    const offline = scannerReducer(INITIAL_SCANNER_STATE, {
      type: "network_offline",
      at,
      feedback: classifyScanFailure(new TypeError("offline")),
    });
    expect(offline.phase).toBe("offline");
    expect(offline.feedback?.kind).toBe("network");

    const online = scannerReducer(offline, { type: "network_online", at: at + 1 });
    expect(online).toEqual(INITIAL_SCANNER_STATE);
  });

  it("only changes context from standby", () => {
    const processing: ScannerState = { phase: "processing", feedback: null, lockedUntil: null };
    expect(scannerReducer(processing, { type: "context_changed" })).toBe(processing);

    expect(scannerReducer(INITIAL_SCANNER_STATE, { type: "context_changed" })).toEqual(
      INITIAL_SCANNER_STATE,
    );
  });

  it("resets from any phase", () => {
    const feedback: ScannerState = { phase: "feedback", feedback: null, lockedUntil: at };
    expect(scannerReducer(feedback, { type: "reset" })).toEqual(INITIAL_SCANNER_STATE);
  });
});

describe("feedback accessibility", () => {
  it("gives every state text and an icon, never colour alone (T-104)", () => {
    const responses: ApiResponse<ScanResultPayload>[] = [
      { ok: true, data: payload() },
      { ok: true, data: payload({ result: "DUPLICATE", reason: "duplicate" }) },
      { ok: true, data: payload({ result: "NOT_ENTITLED", reason: "entitlement_denied" }) },
      { ok: true, data: payload({ result: "INVALID_QR", reason: "qr_invalid" }) },
      { ok: false, error: { code: "FORBIDDEN", message: "Tidak ditugaskan" } },
      { ok: false, error: { code: "INTERNAL", message: "Internal" } },
    ];

    for (const response of responses) {
      const feedback = classifyScanResponse(response);
      expect(feedback.title.length).toBeGreaterThan(0);
      expect(feedback.description.length).toBeGreaterThan(0);
      expect(feedback.icon.length).toBeGreaterThan(0);
      expect(feedback.role).toBe(feedback.tone === "error" ? "alert" : "status");
    }

    const network = classifyScanFailure(new Error("offline"));
    expect(network.title).not.toBe("");
    expect(network.icon).toBe("wifi-off");
  });
});

describe("deep link preselection", () => {
  function context(overrides: Partial<StaffContext> = {}): StaffContext {
    return {
      assignmentId: "a1",
      themeId: "t1",
      themeName: "Tema",
      activityId: "act1",
      activityName: "Registrasi",
      sessionId: null,
      sessionName: null,
      activityStatus: "active",
      sessionStatus: null,
      canManualCheckIn: false,
      ...overrides,
    };
  }

  const sessionContext = context({
    assignmentId: "a2",
    sessionId: "s1",
    sessionName: "Sesi Pagi",
    sessionStatus: "in_progress",
  });

  it("ignores a URL without eventId", () => {
    expect(resolveDeepLinkContext([context()], new URLSearchParams(""))).toEqual({
      context: null,
      rejected: false,
    });
  });

  it("matches the exact Sesi when sessionId is present", () => {
    const result = resolveDeepLinkContext(
      [context(), sessionContext],
      new URLSearchParams("eventId=t1&activityId=act1&sessionId=s1"),
    );
    expect(result.context?.assignmentId).toBe("a2");
    expect(result.rejected).toBe(false);
  });

  it("treats an empty sessionId as a context without Sesi", () => {
    const result = resolveDeepLinkContext(
      [sessionContext, context()],
      new URLSearchParams("eventId=t1&activityId=act1&sessionId="),
    );
    expect(result.context?.assignmentId).toBe("a1");
  });

  it("rejects a link that is not one of the caller's assignments", () => {
    const result = resolveDeepLinkContext(
      [context()],
      new URLSearchParams("eventId=t1&activityId=other&sessionId="),
    );
    expect(result).toEqual({ context: null, rejected: true });
  });

  it("labels activity-wide contexts as all sessions", () => {
    expect(staffContextLabel(context())).toBe("Registrasi · Semua sesi");
    expect(staffContextLabel(sessionContext)).toBe("Registrasi · Sesi Pagi");
  });

  it("keeps expanded Sesi contexts distinct even with one assignment id", () => {
    const sameAssignment = context({
      assignmentId: "a2",
      sessionId: "s1",
      sessionName: "Sesi Pagi",
      sessionStatus: "in_progress",
    });
    const secondSession = { ...sameAssignment, sessionId: "s2", sessionName: "Sesi Siang" };

    expect(staffContextKey(sameAssignment)).not.toBe(staffContextKey(secondSession));
    expect(staffContextKey(context())).toBe("a1::");
  });
});
