import type { EventSummary } from "@absensi/shared";
import { ChevronsUpDown } from "lucide-react";

import { eventTabPath, navigate, type EventTab } from "@/lib/router";

/**
 * Event switcher for the sidebar and the mobile strip.
 *
 * The `id` is owned by the caller because this component is mounted twice at
 * once (sidebar + mobile strip, one of them only hidden with CSS). A static id
 * would be duplicated in the document and `<label for>` would resolve to the
 * hidden copy, leaving the visible select unlabelled.
 *
 * Switching keeps the current tab, so moving between events does not reset the
 * workspace to the overview.
 */
export function EventSwitcher({
  id,
  eventId,
  events,
  activeTab,
}: {
  id: string;
  eventId: string;
  events: EventSummary[] | null;
  activeTab?: EventTab | null;
}) {
  const current = events?.find((event) => event.id === eventId) ?? null;
  const loading = events === null;
  const unavailable = events !== null && events.length === 0;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
        Acara aktif
      </label>

      <div className="relative">
        <select
          id={id}
          value={eventId}
          disabled={loading || unavailable}
          onChange={(event) => {
            const nextEventId = event.target.value;

            if (nextEventId !== eventId) {
              navigate(eventTabPath(nextEventId, activeTab ?? "overview"));
            }
          }}
          className="h-10 w-full appearance-none rounded-full border border-border bg-background px-3 pr-9 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          {!current && (
            <option value={eventId}>{loading ? "Memuat acara…" : "Acara saat ini"}</option>
          )}

          {events?.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>

        <ChevronsUpDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>

      {unavailable && <p className="text-xs text-muted-foreground">Daftar acara tidak tersedia.</p>}
    </div>
  );
}
