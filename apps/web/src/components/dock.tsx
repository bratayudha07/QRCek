import { CalendarDays, CircleUserRound } from "lucide-react";

import { navigate, type AppRoute } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Bottom floating pill navigation dock.
 *
 * Fixed to the viewport, centred, and rounded-full so it reads as a floating
 * control on mobile and desktop alike. Only two destinations exist in Tahap 3
 * (events and account); scan/recap tabs are deliberately absent until their
 * phase is opened (AGENTS.md roadmap rule).
 */

interface DockItem {
  label: string;
  icon: typeof CalendarDays;
  isActive: (route: AppRoute) => boolean;
  go: () => void;
}

const ITEMS: readonly DockItem[] = [
  {
    label: "Acara",
    icon: CalendarDays,
    isActive: (route) =>
      route.name === "events" ||
      route.name === "event" ||
      route.name === "participant" ||
      route.name === "import",
    go: () => navigate("/acara"),
  },
  {
    label: "Akun",
    icon: CircleUserRound,
    isActive: (route) => route.name === "account",
    go: () => navigate("/akun"),
  },
];

export function Dock({ route }: { route: AppRoute }) {
  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/70 bg-background/90 p-1.5 shadow-lg shadow-black/10 backdrop-blur-md"
    >
      {ITEMS.map((item) => {
        const active = item.isActive(route);
        const Icon = item.icon;

        return (
          <button
            key={item.label}
            type="button"
            onClick={item.go}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
