import {
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

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

/**
 * Event workspace navigation: one segmented control with a sliding active
 * background. Five equal columns on desktop; on narrow screens each tab keeps a
 * readable minimum width and the control scrolls horizontally instead of
 * shrinking the labels.
 */
export function EventTabs({ eventId, active }: { eventId: string; active: EventTab }) {
  const activeIndex = EVENT_TABS.findIndex((tab) => tab.key === active);

  return (
    <nav aria-label="Navigasi acara" className="overflow-x-auto">
      <div className="relative flex w-full min-w-[23rem] rounded-full bg-muted p-1">
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-1 rounded-full bg-background shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
          style={{
            width: `calc((100% - 0.5rem) / ${EVENT_TABS.length})`,
            transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
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
                "relative z-10 flex min-w-[4.5rem] flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-medium transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-0 sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="whitespace-nowrap">{tab.label}</span>
            </AppLink>
          );
        })}
      </div>
    </nav>
  );
}
