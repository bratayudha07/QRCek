import type { EventSummary } from "@absensi/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import { EventSearch } from "./event-search";
import { EventSwitcher } from "./event-switcher";
import { EventTabs } from "./event-tabs";
import { Sidebar } from "./sidebar";
import { EventStatusBadge } from "./status-badge";
import { listEvents } from "@/lib/events";

import { eventIdOf, eventTabForRoute, navMode, type NavMode } from "@/lib/navigation";
import { routePath, type AppRoute, type EventTab } from "@/lib/router";
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
  const inEvent = eventId !== null;
  // Only admins may switch events, but every role benefits from the status chip
  // and the schedule, so the fetch is not tied to the switcher.
  const showSwitcher = mode === "admin" && session.status === "authenticated" && inEvent;
  const [collapsed, setCollapsed] = useState(true);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  // Which screen the focus effect ran for last; see the effect below.
  const previousRouteRef = useRef<{ eventId: string | null; tab: EventTab | null }>({
    eventId,
    tab: activeTab,
  });
  const eventContext =
    eventId !== null && session.status === "authenticated"
      ? session.memberships.find((membership) => membership.eventId === eventId)
      : undefined;
  const currentEvent = events?.find((event) => event.id === eventId);
  const [showPalette, setShowPalette] = useState(false);

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
  //
  // Switching tabs is the exception. The activated tab link is already the new
  // focus target, so moving focus into <main> would drop the user out of the tab
  // bar after every click and force a Shift+Tab to get back. The page still
  // starts at the top, because the tab change swaps the whole subtree.
  useEffect(() => {
    const previous = previousRouteRef.current;
    previousRouteRef.current = { eventId, tab: activeTab };
    const tabOnlyChange =
      previous.eventId === eventId && previous.tab !== activeTab && activeTab !== null;

    window.scrollTo(0, 0);
    if (tabOnlyChange) return;

    mainRef.current?.focus({ preventScroll: true });
  }, [routeKey, eventId, activeTab]);

  // Handler shortcut keyboard Ctrl / ⌘ K di AppLayout.
  // Saat ditekan → toggle palette pencarian (showPalette).
  // Escape ditangani oleh EventSearch secara internal.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // biarkan EventSearch menangani tutup palette
        return;
      }
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setShowPalette]);

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
            <div className="app-chrome bg-background">
              <div className="mx-auto w-full max-w-4xl space-y-1 px-4 pb-2 pt-3">
                <div className="flex min-h-10 items-center justify-between">
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
              </div>
            </div>
            <div className="app-chrome sticky top-0 z-20 bg-background/85 shadow-[0_12px_28px_-26px_rgba(15,23,42,0.55)] backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
              <div className="mx-auto w-full max-w-4xl px-4 py-2.5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                  <div className="lg:w-56 lg:shrink-0">
                    <EventSearch
                      eventId={eventId}
                      showPalette={showPalette}
                      setShowPalette={setShowPalette}
                    />
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
