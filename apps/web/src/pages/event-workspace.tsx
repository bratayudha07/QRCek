import { ClipboardCheck, FileText, UserCog } from "lucide-react";

import { EventOverviewPage } from "./event-overview";
import { EventParticipantsPage } from "./event-participants";
import { PlaceholderPage } from "./placeholder";
import type { EventTab } from "@/lib/router";

/**
 * `/admin/events/:id/:tab` — one workspace, five destinations.
 *
 * Only Ringkasan and Peserta have a backend in this stage; the other three tabs
 * exist so the navigation is complete and are explicit placeholders until their
 * phases are opened.
 *
 * The event tab bar is not rendered here: `AppLayout` owns it so it survives the
 * route change (see the note in that file).
 */
export function EventWorkspacePage({ eventId, tab }: { eventId: string; tab: EventTab }) {
  switch (tab) {
    case "overview":
      return <EventOverviewPage eventId={eventId} />;
    case "participants":
      return <EventParticipantsPage eventId={eventId} />;
    case "staff":
      return (
        <PlaceholderPage
          title="Petugas"
          description="Penugasan dan undangan petugas akan tersedia pada tahap berikutnya."
          icon={UserCog}
        />
      );
    case "attendance":
      return (
        <PlaceholderPage
          title="Absensi"
          description="Pencatatan kehadiran dan pemindaian QR akan tersedia pada tahap scan."
          icon={ClipboardCheck}
        />
      );
    case "reports":
      return (
        <PlaceholderPage
          title="Laporan"
          description="Rekap kehadiran dan ekspor laporan akan tersedia pada tahap rekap."
          icon={FileText}
        />
      );
  }
}
