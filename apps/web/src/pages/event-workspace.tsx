import { EventOverviewPage } from "./event-overview";
import { EventActivitiesPage } from "./event-activities";
import { EventStaffPage } from "./event-staff";
import { EventParticipantsPage } from "./event-participants";
import { EventAttendancePage } from "./event-attendance";
import { EventReportsPage } from "./event-reports";
import { EventEntitlementsPage } from "./event-entitlements";
import type { EventTab } from "@/lib/router";

/**
 * `/admin/events/:id/:tab` — one workspace, seven destinations.
 *
 * Event pages share one event-scoped route tree. Worker authorization remains
 * authoritative for each API request.
 *
 * The event tab bar is not rendered here: `AppLayout` owns it so it survives the
 * route change (see the note in that file).
 */
export function EventWorkspacePage({ eventId, tab }: { eventId: string; tab: EventTab }) {
  switch (tab) {
    case "overview":
      return <EventOverviewPage eventId={eventId} />;
    case "activities":
      return <EventActivitiesPage eventId={eventId} />;
    case "participants":
      return <EventParticipantsPage eventId={eventId} />;
    case "staff":
      return <EventStaffPage eventId={eventId} />;
    case "attendance":
      return <EventAttendancePage eventId={eventId} />;
    case "reports":
      return <EventReportsPage eventId={eventId} />;
    case "entitlements":
      return <EventEntitlementsPage eventId={eventId} />;
  }
}
