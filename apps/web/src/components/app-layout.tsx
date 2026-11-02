import type { EventSummary } from "@absensi/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import { EventSearch } from "./event-search";
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
          "min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))] outline-none transition-[padding-left] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:pb-0 print:pb-0 print:pl-0",
          // Capsule geometry: 1rem margin + rail width + 1rem breathing room.
          collapsed ? "lg:pl-[104px]" : "lg:pl-[264px]",
        )}
      >
        {eventId !== null && activeTab !== null && (
          <>
            {/*
              Context block (switcher, status, schedule) scrolls away. It has no
              bottom border: the line used to stop dead at the sidebar edge and
              made the workspace look bolted onto the shell instead of part of
              it. Separation now comes from the floating toolbar below.
            */}
            <div className="app-chrome bg-background">
              <div className="mx-auto w-full max-w-4xl space-y-1 px-4 pb-2 pt-3">
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
              </div>
            </div>

            {/*
              Sticky toolbar: search + tabs stay reachable while the page
              scrolls. Translucency plus backdrop blur is the depth cue, so the
              bar can float over content without drawing a hard rule.
            */}
            <div className="app-chrome sticky top-0 z-20 bg-background/85 shadow-[0_12px_28px_-26px_rgba(15,23,42,0.55)] backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
              <div className="mx-auto w-full max-w-4xl px-4 py-2.5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                  <div className="lg:w-56 lg:shrink-0">
                    <EventSearch eventId={eventId} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <EventTabs eventId={eventId} active={activeTab} />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        <div key={routeKey} className="page-enter">
          {children}
        </div>
      </main>

      <BottomNav mode={mode} route={route} />
    </div>
  );
}
