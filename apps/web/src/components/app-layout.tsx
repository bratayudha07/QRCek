import type { EventSummary } from "@absensi/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import { EventSwitcher } from "./event-switcher";
import { EventTabs } from "./event-tabs";
import { Sidebar } from "./sidebar";
import { EventStatusBadge } from "./status-badge";
import { listEvents } from "@/lib/events";
import { formatSchedule } from "@/lib/format";
import { eventIdOf, eventTabForRoute, navMode, type NavMode } from "@/lib/navigation";
import { routePath, type AppRoute } from "@/lib/router";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/**
 * Frame for every authenticated screen: global navigation (desktop sidebar,
 * mobile bottom nav), the event navigation row, and the content area.
 *
 * The event tabs live here, above the keyed page subtree, for two reasons: they
 * must survive a route change or the sliding indicator would be re-created
 * already in its final position (no transition), and the tab bar should not
 * fade with the page transition.
 *
 * The page subtree is keyed on the canonical route, so switching events or tabs
 * remounts the page instead of letting the previous event's loaded state
 * linger. Each workspace page also keys its fetches on `eventId`; the key here
 * is the second line of defence.
 */
export function AppLayout({ route, children }: { route: AppRoute; children: ReactNode }) {
  const session = useSession();
  const mode: NavMode = session.status === "authenticated" ? navMode(session.user.role) : "admin";

  const eventId = eventIdOf(route);
  const activeTab = eventTabForRoute(route);
  const routeKey = routePath(route) ?? route.name;
  const showSwitcher =
    mode === "admin" && session.status === "authenticated" && eventId !== null;
  const [collapsed, setCollapsed] = useState(true);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const eventContext =
    eventId !== null && session.status === "authenticated"
      ? session.memberships.find((membership) => membership.eventId === eventId)
      : undefined;
  const currentEvent = events?.find((event) => event.id === eventId);

  useEffect(() => {
    if (!showSwitcher) {
      setEvents(null);
      return;
    }

    let cancelled = false;
    setEvents(null);

    listEvents()
      .then((body) => {
        if (cancelled) return;
        setEvents(body.ok ? body.data.events : []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [showSwitcher, eventId]);

  // A new screen starts at the top and takes focus: without this the SPA keeps
  // the previous page's scroll offset and leaves focus on a link that no longer
  // exists, which strands keyboard and screen-reader users.
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [routeKey]);

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="app-chrome sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-2 focus:outline-offset-2"
      >
        Lewati ke konten
      </a>

      <Sidebar
        mode={mode}
        route={route}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />

      <main
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
        className={cn(
          "min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))] outline-none transition-[padding-left] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none lg:pb-0 print:pb-0 print:pl-0",
          collapsed ? "lg:pl-[76px]" : "lg:pl-[256px]",
        )}
      >
        {eventId !== null && activeTab !== null && (
          <div className="app-chrome border-b border-border/70 bg-background">
            <div className="mx-auto w-full max-w-3xl space-y-2 px-4 py-3">
              <div className="flex min-h-10 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {showSwitcher ? (
                    <EventSwitcher
                      id="event-switcher-context"
                      eventId={eventId}
                      events={events}
                      activeTab={activeTab}
                      compact
                    />
                  ) : (
                    <p className="truncate px-3 text-base font-semibold tracking-tight">
                      {eventContext?.eventName ?? "Acara"}
                    </p>
                  )}
                </div>
                {currentEvent && <EventStatusBadge status={currentEvent.status} />}
              </div>
              {currentEvent && (
                <p className="truncate px-3 text-xs text-muted-foreground">
                  {formatSchedule(currentEvent.startsAt, currentEvent.endsAt, currentEvent.timezone)}
                </p>
              )}
              <EventTabs eventId={eventId} active={activeTab} />
            </div>
          </div>
        )}

        <div key={routeKey} className="page-enter">
          {children}
        </div>
      </main>

      <BottomNav mode={mode} route={route} />
    </div>
  );
}
