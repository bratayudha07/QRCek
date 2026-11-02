import {
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppLink } from "@/components/app-link";
import { EVENT_TABS } from "@/lib/navigation";
import { eventTabPath, type EventTab } from "@/lib/router";
import { cn } from "@/lib/utils";

const ICONS: Record<EventTab, LucideIcon> = {
  overview: LayoutDashboard,
  participants: UsersRound,
  staff: UserCog,
  attendance: ClipboardCheck,
  reports: FileText,
};

/** Breathing room kept between the active tab and the edge of the scroll box. */
const EDGE_MARGIN = 8;

/**
 * Event workspace navigation: one segmented control with a sliding active
 * background over five equal columns.
 *
 * Below 23rem the columns would be unreadable, so the control scrolls
 * horizontally instead of shrinking. Because of that a deep link can land on a
 * tab that is scrolled out of view: the active tab is brought into the box on
 * mount and on change, and a fade marks whichever edge still has content. Both
 * only touch the control's own scroll offset, never the page.
 */
export function EventTabs({ eventId, active }: { eventId: string; active: EventTab }) {
  const activeIndex = Math.max(
    EVENT_TABS.findIndex((tab) => tab.key === active),
    0,
  );
  const navRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  // `aria-current="page"` is the source of truth for which tab is active, so
  // reading it back is more reliable than mapping an index onto the grid
  // children (the sliding indicator is a child too).
  useEffect(() => {
    const nav = navRef.current;
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !tab) return;

    const box = nav.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();

    if (rect.left < box.left + EDGE_MARGIN) {
      nav.scrollLeft -= box.left + EDGE_MARGIN - rect.left;
    } else if (rect.right > box.right - EDGE_MARGIN) {
      nav.scrollLeft += rect.right - (box.right - EDGE_MARGIN);
    }
  }, [active]);

  // The fades are the only hint that the row scrolls, so they must show up on
  // the side that actually has more content and disappear at the ends.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const sync = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      const start = nav.scrollLeft > 1;
      const end = nav.scrollLeft < max - 1;
      setEdges((previous) =>
        previous.start === start && previous.end === end ? previous : { start, end },
      );
    };

    sync();
    nav.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(nav);

    return () => {
      nav.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <nav
        ref={navRef}
        aria-label="Navigasi acara"
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="relative grid w-full min-w-[23rem] grid-cols-5 rounded-full bg-muted p-1">
          <span
            aria-hidden="true"
            className="absolute inset-y-1 left-1 rounded-full bg-background shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
            style={{
              width: `calc((100% - 0.5rem) / ${EVENT_TABS.length})`,
              transform: `translateX(${activeIndex * 100}%)`,
            }}
          />

          {EVENT_TABS.map((tab) => {
            const Icon = ICONS[tab.key];
            const isActive = tab.key === active;

            return (
              <AppLink
                key={tab.key}
                href={eventTabPath(eventId, tab.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  // `outline-offset-0` keeps the focus ring inside the scroll
                  // container: `overflow-x-auto` on the wrapper would clip it.
                  "relative z-10 flex flex-col items-center justify-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-medium transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-0 sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </AppLink>
            );
          })}
        </div>
      </nav>

      {edges.start && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 left-0 w-6 rounded-full bg-gradient-to-r from-background via-background/70 to-transparent"
        />
      )}
      {edges.end && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 right-0 w-6 rounded-full bg-gradient-to-l from-background via-background/70 to-transparent"
        />
      )}
    </div>
  );
}
