import type {
  Activity,
  ActivitySession,
  EntitlementCategoryCell,
  EntitlementCategoryRulesRequest,
  EntitlementCategoryRulesPayload,
  EntitlementDefaultPayload,
  EntitlementDefaultRequest,
  EntitlementMatrixPayload,
  EntitlementParticipantRulePayload,
  EntitlementParticipantRuleRequest,
  EntitlementStatus,
  EventAccessRole,
  EventStatus,
} from "@absensi/shared";

import { apiRequest } from "./http";

/**
 * Typed bindings and pure view helpers for the Q3 entitlement UI
 * (DESAIN_API.md §6, ADR-0016).
 *
 * The Worker owns every rule: which statuses are accepted, whether a scope is
 * mutable, and how the resolver walks the levels. This module only builds paths
 * and turns a matrix payload into rows a table can render.
 */

function activityBasePath(eventId: string, activityId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/activities/${encodeURIComponent(activityId)}`;
}

export function activityEntitlementsPath(eventId: string, activityId: string): string {
  return `${activityBasePath(eventId, activityId)}/entitlements`;
}

export function sessionEntitlementsPath(
  eventId: string,
  activityId: string,
  sessionId: string,
): string {
  return `${activityBasePath(eventId, activityId)}/sessions/${encodeURIComponent(sessionId)}/entitlements`;
}

export function themeDefaultPath(eventId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/entitlements/default`;
}

export function activityCategoryRulesPath(eventId: string, activityId: string): string {
  return `${activityEntitlementsPath(eventId, activityId)}/categories`;
}

export function sessionCategoryRulesPath(
  eventId: string,
  activityId: string,
  sessionId: string,
): string {
  return `${sessionEntitlementsPath(eventId, activityId, sessionId)}/categories`;
}

export function activityParticipantOverridePath(
  eventId: string,
  activityId: string,
  participantId: string,
): string {
  return `${activityEntitlementsPath(eventId, activityId)}/participants/${encodeURIComponent(participantId)}`;
}

export function sessionParticipantOverridePath(
  eventId: string,
  activityId: string,
  sessionId: string,
  participantId: string,
): string {
  return `${sessionEntitlementsPath(eventId, activityId, sessionId)}/participants/${encodeURIComponent(participantId)}`;
}

export function getActivityEntitlements(eventId: string, activityId: string) {
  return apiRequest<EntitlementMatrixPayload>(activityEntitlementsPath(eventId, activityId));
}

export function getThemeDefault(eventId: string) {
  return apiRequest<EntitlementDefaultPayload>(themeDefaultPath(eventId));
}

export function putThemeDefault(eventId: string, input: EntitlementDefaultRequest) {
  return apiRequest<EntitlementDefaultPayload>(themeDefaultPath(eventId), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteThemeDefault(eventId: string) {
  return apiRequest<EntitlementDefaultPayload>(themeDefaultPath(eventId), {
    method: "DELETE",
  });
}

export function putActivityCategoryRules(
  eventId: string,
  activityId: string,
  input: EntitlementCategoryRulesRequest,
) {
  return apiRequest<EntitlementCategoryRulesPayload>(
    activityCategoryRulesPath(eventId, activityId),
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function putSessionCategoryRules(
  eventId: string,
  activityId: string,
  sessionId: string,
  input: EntitlementCategoryRulesRequest,
) {
  return apiRequest<EntitlementCategoryRulesPayload>(
    sessionCategoryRulesPath(eventId, activityId, sessionId),
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function putActivityParticipantOverride(
  eventId: string,
  activityId: string,
  participantId: string,
  input: EntitlementParticipantRuleRequest,
) {
  return apiRequest<EntitlementParticipantRulePayload>(
    activityParticipantOverridePath(eventId, activityId, participantId),
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function deleteActivityParticipantOverride(
  eventId: string,
  activityId: string,
  participantId: string,
) {
  return apiRequest<EntitlementParticipantRulePayload>(
    activityParticipantOverridePath(eventId, activityId, participantId),
    { method: "DELETE" },
  );
}

export function putSessionParticipantOverride(
  eventId: string,
  activityId: string,
  sessionId: string,
  participantId: string,
  input: EntitlementParticipantRuleRequest,
) {
  return apiRequest<EntitlementParticipantRulePayload>(
    sessionParticipantOverridePath(eventId, activityId, sessionId, participantId),
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function deleteSessionParticipantOverride(
  eventId: string,
  activityId: string,
  sessionId: string,
  participantId: string,
) {
  return apiRequest<EntitlementParticipantRulePayload>(
    sessionParticipantOverridePath(eventId, activityId, sessionId, participantId),
    { method: "DELETE" },
  );
}

const STATUS_LABEL: Record<EntitlementStatus, string> = {
  allowed: "Diizinkan",
  denied: "Ditolak",
  inherit: "Ikut bawaan",
};

/** `null` means the category has no row in this scope yet. */
export function entitlementStatusLabel(status: EntitlementStatus | null): string {
  return status === null ? "Belum diatur" : STATUS_LABEL[status];
}

/** The activity-level scope has no session id; the key is stable for selects. */
export const ACTIVITY_SCOPE_KEY = "activity";

export interface EntitlementScopeOption {
  key: string;
  label: string;
  sessionId: string | null;
}

/**
 * Activity scope first, then one entry per Sesi. Archived Sesi stay listed so a
 * rule that already exists on one remains reachable.
 */
export function scopeOptions(
  activity: Activity,
  sessions: readonly ActivitySession[],
): EntitlementScopeOption[] {
  return [
    {
      key: ACTIVITY_SCOPE_KEY,
      label: "Aktivitas (semua Sesi)",
      sessionId: null,
    },
    ...sessions
      .filter((session) => session.activityId === activity.id)
      .map((session) => ({
        key: session.id,
        label: session.name,
        sessionId: session.id,
      })),
  ];
}

/** Category rows for the selected scope; an unknown Sesi yields no rows. */
export function categoryRows(
  matrix: EntitlementMatrixPayload,
  sessionId: string | null,
): EntitlementCategoryCell[] {
  if (sessionId === null) return matrix.categories;

  const session = matrix.sessions.find((item) => item.sessionId === sessionId);
  return session?.categories ?? [];
}

export interface EntitlementOverrideRow {
  participantId: string;
  status: EntitlementStatus;
  /** Participant name when known, otherwise the short id. */
  name: string;
  /** True when the row is showing the id fallback instead of a name. */
  nameFromId: boolean;
}

/** The API only returns ids; a short suffix keeps the row identifiable. */
export function shortParticipantId(participantId: string): string {
  return participantId.length <= 6 ? participantId : participantId.slice(-6);
}

/**
 * Participant overrides for the selected scope, with names looked up from the
 * caller's cache (search results). Unknown participants fall back to the short
 * id instead of hiding the rule.
 */
export function overrideRows(
  matrix: EntitlementMatrixPayload,
  sessionId: string | null,
  participantNames: Readonly<Record<string, string>> = {},
): EntitlementOverrideRow[] {
  const cells =
    sessionId === null
      ? matrix.participants
      : (matrix.sessions.find((item) => item.sessionId === sessionId)?.participants ?? []);

  return cells
    .map((cell) => {
      const name = participantNames[cell.participantId]?.trim();

      if (name) {
        return {
          participantId: cell.participantId,
          status: cell.status,
          name,
          nameFromId: false,
        };
      }

      return {
        participantId: cell.participantId,
        status: cell.status,
        name: shortParticipantId(cell.participantId),
        nameFromId: true,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "id"));
}

/** Names of the active categories that still have no row in this Aktivitas. */
export function missingCategoryNames(matrix: EntitlementMatrixPayload): string[] {
  const nameById = new Map(matrix.categories.map((cell) => [cell.categoryId, cell.name]));
  return matrix.missingCategoryIds.map((categoryId) => nameById.get(categoryId) ?? categoryId);
}

/**
 * Only Admin Acara and Super Admin may configure entitlements, and never on an
 * archived Tema. The Worker re-checks this on every write; this only decides
 * whether the controls are rendered.
 */
export function canEditEntitlements(
  accessRole: EventAccessRole,
  eventStatus: EventStatus,
): boolean {
  return (
    (accessRole === "event_admin" || accessRole === "superadmin") && eventStatus !== "archived"
  );
}

/**
 * Preferred Aktivitas for the page: the first active one, attendance first.
 * Falls back to the first non-archived Aktivitas so the page still opens when
 * nothing is active yet.
 */
export function defaultActivityId(activities: readonly Activity[]): string | null {
  const active = activities.filter(
    (activity) => activity.status === "active" && activity.archivedAt === null,
  );
  const attendance = active.find((activity) => activity.transactionType === "attendance");
  const chosen = attendance ?? active[0];

  if (chosen) return chosen.id;

  return activities.find((activity) => activity.archivedAt === null)?.id ?? null;
}
