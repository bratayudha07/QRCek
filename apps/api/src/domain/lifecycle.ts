import type { ActivityStatus, SessionStatus } from "@absensi/shared";
import {
  canArchiveSession,
  canTransitionActivity,
  canTransitionSession,
} from "@absensi/shared";

/**
 * Aktivitas/Sesi lifecycle (ADR-0012).
 *
 * The transition tables live in `packages/shared/src/lifecycle.ts` so the UI and
 * the Worker cannot disagree. This module only adds the API's user-facing
 * messages; the rule itself stays a pure function.
 */

export function activityTransitionMessage(from: ActivityStatus, to: ActivityStatus): string {
  if (from === "archived") return "Aktivitas yang sudah diarsipkan bersifat final";
  return `Status Aktivitas tidak dapat berubah dari ${from} ke ${to}`;
}

export function sessionTransitionMessage(from: SessionStatus, to: SessionStatus): string {
  return `Status Sesi tidak dapat berubah dari ${from} ke ${to}`;
}

export function sessionArchiveMessage(status: SessionStatus): string {
  if (status === "completed" || status === "disabled") {
    return "Sesi sudah diarsipkan";
  }
  return "Sesi hanya dapat diarsipkan setelah selesai atau dinonaktifkan";
}

export { canArchiveSession, canTransitionActivity, canTransitionSession };
