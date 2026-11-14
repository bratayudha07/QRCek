import {
  CalendarClock,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ShieldCheck,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppLink } from "@/components/app-link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EVENT_TABS } from "@/lib/navigation";
import { eventTabPath, type EventTab } from "@/lib/router";
import { cn } from "@/lib/utils";

const ICONS: Record<EventTab, LucideIcon> = {
  overview: LayoutDashboard,
  activities: CalendarClock,
  participants: UsersRound,
  staff: UserCog,
  attendance: ClipboardCheck,
  reports: FileText,
  entitlements: ShieldCheck,
};

/** Breathing room kept between the active tab and the edge of the scroll box. */
const EDGE_MARGIN = 8;

/**
 * Event workspace navigation built from the shadcn/ui `Tabs` primitives.
 *
 * Each trigger renders a real `<AppLink>`, so the tab is still a link: deep
 * links, middle-click, and "open in new tab" keep working. Base UI supplies the
 * roving tabindex and the ARIA state; the router remains the source of truth
 * for which tab is active.
 *
 * Below 31rem the control scrolls horizontally instead of shrinking. A deep
 * link can land on a tab that is scrolled out of view, so the active tab is
 * brought into the box on mount and on change, and a fade marks whichever edge
 * still has content. Both only touch the control's own scroll offset.
 */
export function EventTabs({ eventId, active }: { eventId: string; active: EventTab }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const box = scrollRef.current;
    const tab = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !tab) return;

    const outer = box.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();

    if (rect.left < outer.left + EDGE_MARGIN) {
      box.scrollLeft -= outer.left + EDGE_MARGIN - rect.left;
    } else if (rect.right > outer.right - EDGE_MARGIN) {
      box.scrollLeft += rect.right - (outer.right - EDGE_MARGIN);
    }
  }, [active]);

  // The fades are the only hint that the row scrolls, so they must show up on
  // the side that actually has more content and disappear at the ends.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;

    const sync = () => {
      const max = box.scrollWidth - box.clientWidth;
      const start = box.scrollLeft > 1;
      const end = box.scrollLeft < max - 1;
      setEdges((previous) =>
        previous.start === start && previous.end === end ? previous : { start, end },
      );
    };

    sync();
    box.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(box);

    return () => {
      box.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Tabs value={active} className="w-full min-w-[31rem]">
          <TabsList className="grid w-full grid-cols-7 rounded-full p-1 group-data-[orientation=horizontal]/tabs:h-auto">
            {EVENT_TABS.map((tab) => {
              const Icon = ICONS[tab.key];
              const isActive = tab.key === active;

              return (
                <TabsTrigger
                  key={tab.key}
                  value={tab.key}
                  render={
                    <AppLink
                      href={eventTabPath(eventId, tab.key)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="whitespace-nowrap">{tab.label}</span>
                    </AppLink>
                  }
                  className={cn(
                    "flex-col gap-1 rounded-full px-2 py-1.5 text-[11px] sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm",
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                />
              );
            })}
          </TabsList>
        </Tabs>
      </div>

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
