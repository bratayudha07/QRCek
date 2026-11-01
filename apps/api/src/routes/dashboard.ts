import { z } from "zod";

import type {
  EventDashboardPayload,
  GlobalDashboardPayload,
} from "@absensi/shared";
import { EventIdSchema, attendancePercentage } from "@absensi/shared";

import { countAttendance, listRecentAttendance } from "../db/attendance";
import { listDashboardEvents } from "../db/dashboard";
import { countParticipantsByStatus, findEventById } from "../db/events";
import { authOf, requireEventAccess } from "../http/auth";
import { notFound } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parsePathParams } from "../http/validate";

/** Dashboard aggregates (DESAIN_API.md §4). Server-side totals only. */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const RECENT_LIMIT = 10;

async function eventDashboard(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "recap:read");

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");

  const participants = await countParticipantsByStatus(ctx.env.DB, eventId);
  const attendance = await countAttendance(ctx.env.DB, eventId);
  const recent = await listRecentAttendance(ctx.env.DB, eventId, RECENT_LIMIT);

  const presentCount = attendance.present + attendance.late;

  const payload: EventDashboardPayload = {
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      allowManual: event.allow_manual === 1,
    },
    totalParticipants: participants.total,
    activeParticipants: participants.active,
    presentCount,
    notPresentCount: Math.max(0, participants.total - presentCount),
    attendancePercentage: attendancePercentage(presentCount, participants.total),
    byStatus: {
      present: attendance.present,
      late: attendance.late,
      absent: attendance.absent,
      excused: attendance.excused,
    },
    recent: recent.map((row) => ({
      participantId: row.participant_id,
      participantName: row.participant_name,
      category: row.category,
      status: row.status,
      checkedInAt: row.checked_in_at,
    })),
    lastAttendanceAt: attendance.lastAttendanceAt,
  };

  return { data: payload };
}

async function globalDashboard(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const rows = await listDashboardEvents(ctx.env.DB, {
    userId: auth.user.id,
    isSuperadmin: auth.user.role === "superadmin",
  });

  const events = rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    accessRole: row.access_role,
    participantCount: row.participant_count,
    presentCount: row.present_count,
    attendancePercentage: attendancePercentage(row.present_count, row.participant_count),
  }));

  const totals = events.reduce(
    (sum, event) => ({
      participants: sum.participants + event.participantCount,
      present: sum.present + event.presentCount,
    }),
    { participants: 0, present: 0 },
  );

  const payload: GlobalDashboardPayload = {
    events,
    totals: {
      events: events.length,
      participants: totals.participants,
      present: totals.present,
      attendancePercentage: attendancePercentage(totals.present, totals.participants),
    },
  };

  return { data: payload };
}

export const dashboardRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/dashboard",
    public: false,
    handler: globalDashboard,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/dashboard",
    public: false,
    handler: eventDashboard,
  },
];
