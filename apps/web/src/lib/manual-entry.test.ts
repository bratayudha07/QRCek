import type { AttendanceRecord, StaffContext } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  canUseManualEntry,
  manualEntryRequest,
  manualEntryStatuses,
  manualEntrySuccessMessage,
} from "./manual-entry";

/** Q5 Manual Entry: pure helpers, no DOM and no I/O. */

function context(overrides: Partial<StaffContext> = {}): StaffContext {
  return {
    assignmentId: "asg1",
    themeId: "EVT",
    themeName: "Tema",
    activityId: "act1",
    activityName: "Aktivitas",
    sessionId: null,
    sessionName: null,
    activityStatus: "active",
    sessionStatus: null,
    canManualCheckIn: true,
    ...overrides,
  };
}

function record(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: "att1",
    eventId: "EVT",
    eventName: "Tema",
    participantId: "p1",
    participantName: "Budi",
    participantExternalRef: null,
    category: null,
    status: "present",
    checkedInAt: 1_760_000_000_000,
    recordedBy: "u1",
    recordedByName: "Petugas",
    method: "manual",
    note: null,
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

describe("manualEntryStatuses", () => {
  it("offers the four attendance statuses with Indonesian labels", () => {
    expect(manualEntryStatuses()).toEqual([
      { status: "present", label: "Hadir" },
      { status: "late", label: "Terlambat" },
      { status: "excused", label: "Izin" },
      { status: "absent", label: "Tidak hadir" },
    ]);
  });
});

describe("canUseManualEntry", () => {
  it("allows a ready context with the assignment flag", () => {
    expect(canUseManualEntry(context())).toBe(true);
  });

  it("refuses an assignment without the Manual Check-in flag", () => {
    expect(canUseManualEntry(context({ canManualCheckIn: false }))).toBe(false);
  });

  it("refuses a context the scanner would not accept", () => {
    expect(canUseManualEntry(context({ activityStatus: "completed" }))).toBe(false);
    expect(canUseManualEntry(context({ activityStatus: "archived" }))).toBe(false);
    expect(
      canUseManualEntry(
        context({ sessionId: "ses1", sessionName: "Sesi", sessionStatus: "scheduled" }),
      ),
    ).toBe(false);
  });

  it("allows a context whose Sesi is in progress", () => {
    expect(
      canUseManualEntry(
        context({ sessionId: "ses1", sessionName: "Sesi", sessionStatus: "in_progress" }),
      ),
    ).toBe(true);
  });
});

describe("manualEntryRequest", () => {
  it("takes the Aktivitas from the context and omits a null Sesi", () => {
    const input = manualEntryRequest(context(), "p1", "present", "");

    expect(input).toEqual({ participantId: "p1", activityId: "act1", status: "present" });
    expect("sessionId" in input).toBe(false);
  });

  it("includes the Sesi when the context has one", () => {
    const input = manualEntryRequest(
      context({ sessionId: "ses1", sessionName: "Sesi", sessionStatus: "in_progress" }),
      "p1",
      "late",
      "Kartu rusak",
    );

    expect(input).toEqual({
      participantId: "p1",
      activityId: "act1",
      sessionId: "ses1",
      status: "late",
      note: "Kartu rusak",
    });
  });

  it("drops a blank note instead of sending an empty string", () => {
    const input = manualEntryRequest(context(), "p1", "present", "   ");

    expect("note" in input).toBe(false);
    expect(manualEntryRequest(context(), "p1", "present", undefined)).not.toHaveProperty("note");
    expect(manualEntryRequest(context(), "p1", "present", null)).not.toHaveProperty("note");
  });

  it("trims the note it does send", () => {
    expect(manualEntryRequest(context(), "p1", "present", "  tanpa kartu  ").note).toBe(
      "tanpa kartu",
    );
  });
});

describe("manualEntrySuccessMessage", () => {
  it("names the participant and the recorded status", () => {
    expect(manualEntrySuccessMessage(record())).toBe(
      "Kehadiran manual tercatat untuk Budi (Hadir).",
    );
    expect(manualEntrySuccessMessage(record({ participantName: "Siti", status: "late" }))).toBe(
      "Kehadiran manual tercatat untuk Siti (Terlambat).",
    );
  });
});
