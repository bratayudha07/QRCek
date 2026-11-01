import type { EventSummary } from "@absensi/shared";
import { CalendarCheck2, ChevronsUpDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { AppLink } from "./app-link";
import { EventSwitcher } from "./event-switcher";
import { NavIcon } from "./nav-icon";
import {
  eventTabForRoute,
  isGlobalNavActive,
  sidebarItems,
  type GlobalNavItem,
  type NavMode,
} from "@/lib/navigation";
import type { AppRoute } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Desktop global navigation: a collapsible icon rail (76 px) that expands to a
 * labelled sidebar (248 px). Collapsed items keep their accessible name (the
 * label stays in the DOM as `sr-only` text) and show the label in a tooltip on
 * hover *and* keyboard focus, which a native `title` cannot do.
 */
export function Sidebar({
  mode,
  route,
  collapsed,
  onToggle,
  eventId,
  events,
  showSwitcher,
}: {
  mode: NavMode;
  route: AppRoute;
  collapsed: boolean;
  onToggle: () => void;
  eventId: string | null;
  events: EventSummary[] | null;
  showSwitcher: boolean;
}) {
  const items = sidebarItems(mode);

  return (
    <aside
      id="app-sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border/70 bg-background transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex",
        collapsed ? "w-[76px]" : "w-[248px]",
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 px-3",
          collapsed && "justify-center px-0",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CalendarCheck2 aria-hidden="true" className="size-5" />
        </span>
        <span className={cn("truncate text-sm font-semibold tracking-tight", collapsed && "sr-only")}>
          Absensi
        </span>
      </div>

      {showSwitcher && eventId !== null && (
        <div
          className={cn(
            "shrink-0 border-y border-border/70",
            collapsed ? "px-2 py-2" : "px-3 py-3",
          )}
        >
          {collapsed ? (
            // The full select does not fit the rail; expanding is one click and
            // keeps a single, labelled control instead of a mystery icon select.
            <button
              type="button"
              onClick={onToggle}
              title="Ganti acara"
              aria-label="Ganti acara — perluas sidebar"
              className="flex h-10 w-full items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <ChevronsUpDown aria-hidden="true" className="size-5 shrink-0" />
            </button>
          ) : (
            <EventSwitcher
              id="event-switcher-sidebar"
              eventId={eventId}
              events={events}
              activeTab={eventTabForRoute(route)}
            />
          )}
        </div>
      )}

      {/* Collapsed, the rail never overflows (four 40 px items), so clipping is
          off and the tooltips can escape the navigation box. */}
      <nav
        aria-label="Navigasi utama"
        className={cn("flex-1 p-2", !collapsed && "overflow-y-auto")}
      >
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.key}>
              <SidebarLink item={item} route={route} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-border/70 p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          title={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-5 shrink-0" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-5 shrink-0" />
          )}
          <span className={cn("truncate", collapsed && "sr-only")}>
            {collapsed ? "Perluas" : "Ciutkan"}
          </span>
        </button>
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  route,
  collapsed,
}: {
  item: GlobalNavItem;
  route: AppRoute;
  collapsed: boolean;
}) {
  const active = isGlobalNavActive(item.key, route);

  return (
    <AppLink
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2",
        active
          ? "bg-primary/10 font-semibold text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <NavIcon name={item.key} className="size-5 shrink-0" />
      <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>

      {collapsed && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          {item.label}
        </span>
      )}
    </AppLink>
  );
}
