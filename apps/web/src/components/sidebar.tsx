import { PanelLeftClose, PanelLeftOpen, Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppLink } from "./app-link";
import { NavIcon } from "./nav-icon";
import {
  isGlobalNavActive,
  sidebarItems,
  type GlobalNavItem,
  type NavMode,
} from "@/lib/navigation";
import type { AppRoute } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Desktop global navigation: a compact icon rail that expands on pointer hover
 * or keyboard focus. Expansion overlays the page unless the user pins it open.
 */
export function Sidebar({
  mode,
  route,
  collapsed,
  onToggle,
}: {
  mode: NavMode;
  route: AppRoute;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const items = sidebarItems(mode);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [suppressAutoOpen, setSuppressAutoOpen] = useState(false);
  const expanded = !collapsed || (!suppressAutoOpen && (hoverOpen || focusOpen));
  const compact = !expanded;

  useEffect(() => clearCloseTimer, []);

  function clearCloseTimer() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function pointerEnter(pointerType: string) {
    if (pointerType === "touch") return;
    clearCloseTimer();
    setSuppressAutoOpen(false);
    setHoverOpen(true);
  }

  function pointerLeave(pointerType: string) {
    if (pointerType === "touch") return;
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setHoverOpen(false);
      closeTimer.current = null;
    }, 220);
  }

  function togglePinnedState() {
    if (collapsed) {
      setSuppressAutoOpen(false);
      onToggle();
      return;
    }

    setSuppressAutoOpen(true);
    setFocusOpen(false);
    onToggle();
  }

  function handleBlur(relatedTarget: EventTarget | null) {
    if (relatedTarget instanceof Node && sidebarRef.current?.contains(relatedTarget)) return;
    setFocusOpen(false);
  }

  return (
    <aside
      ref={sidebarRef}
      id="app-sidebar"
      onPointerEnter={(event) => pointerEnter(event.pointerType)}
      onPointerLeave={(event) => pointerLeave(event.pointerType)}
      onFocusCapture={() => {
        clearCloseTimer();
        setFocusOpen(true);
        setSuppressAutoOpen(false);
      }}
      onBlurCapture={(event) => handleBlur(event.relatedTarget)}
      className={cn(
        "app-chrome fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border/70 bg-background transition-[width,box-shadow] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none lg:flex",
        expanded ? "w-[256px] shadow-lg" : "w-[76px]",
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 px-3",
          compact && "justify-center px-0",
        )}
      >
        <img src="/brand-mark.svg" alt="" className="size-9 shrink-0 rounded-lg" />
        <span className={cn("truncate text-sm font-semibold tracking-tight", compact && "sr-only")}>
          Absensi
        </span>
      </div>

      {/* Collapsed, the rail never overflows (four 40 px items), so clipping is
          off and the tooltips can escape the navigation box. */}
      <nav
        aria-label="Navigasi utama"
        className={cn("flex-1 p-2", expanded && "overflow-y-auto")}
      >
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.key}>
              <SidebarLink item={item} route={route} collapsed={compact} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-border/70 p-2">
        <button
          type="button"
          onClick={togglePinnedState}
          aria-expanded={expanded}
          aria-pressed={!collapsed}
          aria-controls="app-sidebar"
          title={collapsed ? "Sematkan sidebar terbuka" : "Ciutkan sidebar"}
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2",
            compact && "justify-center px-0",
          )}
        >
          {collapsed ? (
            compact ? <PanelLeftOpen aria-hidden="true" className="size-5 shrink-0" /> : <Pin aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-5 shrink-0" />
          )}
          <span className={cn("truncate", compact && "sr-only")}>
            {collapsed ? "Sematkan" : "Ciutkan"}
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
        "group relative flex h-10 items-center gap-3 rounded-full px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2",
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
