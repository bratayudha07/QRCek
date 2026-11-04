import { PanelLeftClose, PanelLeftOpen, Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppLink } from "./app-link";
import { NavIcon } from "./nav-icon";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
 * Built from the shadcn/ui `Sidebar` composition; each item is still an
 * `AppLink`, so navigation stays client-side.
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
    }, 320);
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
    <SidebarProvider open={!collapsed} onOpenChange={togglePinnedState}>
      <SidebarRoot
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
          // Floating capsule, not a full-height wall: the rail only covers what
          // the navigation needs, so the page is not visually cut in two.
          "app-chrome fixed left-4 top-4 z-30 hidden max-h-[calc(100dvh-2rem)] flex-col rounded-3xl border border-border/60 bg-background/90 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.34)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 transition-[width,box-shadow] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:flex",
          expanded ? "w-[232px]" : "w-[72px]",
        )}
      >
        <SidebarHeader className="relative flex h-14 shrink-0 flex-row items-center px-3">
          <img
            src="/brand-mark.svg"
            alt=""
            className={cn(
              "size-9 shrink-0 rounded-lg transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              compact && "translate-x-[6px]",
            )}
          />
          <span
            className={cn(
              "pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 whitespace-nowrap text-sm font-semibold tracking-tight transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              compact
                ? "translate-x-1 opacity-0"
                : "translate-x-0 opacity-100 delay-[80ms]",
            )}
          >
            Absensi
          </span>
        </SidebarHeader>

        {/* Collapsed, the rail never overflows (four 40 px items), so clipping is
            off and the tooltips can escape the navigation box. */}
        <SidebarContent>
          <nav
            aria-label="Navigasi utama"
            className={cn("flex-1 p-2", expanded && "overflow-y-auto")}
          >
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarLink item={item} route={route} collapsed={compact} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </nav>
        </SidebarContent>

        {/* The rule is inset so it cannot run into the capsule's rounded edge. */}
        <SidebarFooter className="shrink-0 p-2">
          <div className="border-t border-border/70 pt-2">
            <SidebarTrigger
              aria-expanded={expanded}
              aria-pressed={!collapsed}
              aria-controls="app-sidebar"
              title={collapsed ? "Sematkan sidebar terbuka" : "Ciutkan sidebar"}
              className="relative flex h-10 w-full items-center justify-start gap-3 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {collapsed ? (
                compact ? <PanelLeftOpen aria-hidden="true" className="size-5 shrink-0 translate-x-[6px] transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" /> : <Pin aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <PanelLeftClose aria-hidden="true" className={cn("size-5 shrink-0 transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", compact && "translate-x-[6px]")} />
              )}
              <span
                className={cn(
                  "pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 whitespace-nowrap transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                  compact
                    ? "translate-x-1 opacity-0"
                    : "translate-x-0 opacity-100 delay-[80ms]",
                )}
              >
                {collapsed ? "Sematkan" : "Ciutkan"}
              </span>
            </SidebarTrigger>
          </div>
        </SidebarFooter>
      </SidebarRoot>
    </SidebarProvider>
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
    <SidebarMenuButton asChild isActive={active} className="group">
      <AppLink
        href={item.href}
        aria-current={active ? "page" : undefined}
        className="relative"
      >
        <NavIcon
          name={item.key}
          className={cn(
            "size-5 shrink-0 transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            collapsed && "translate-x-[6px]",
          )}
        />
        <span
          className={cn(
            "pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 whitespace-nowrap transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            collapsed
              ? "translate-x-1 opacity-0"
              : "translate-x-0 opacity-100 delay-[80ms]",
          )}
        >
          {item.label}
        </span>

        {collapsed && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-md transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
          >
            {item.label}
          </span>
        )}
      </AppLink>
    </SidebarMenuButton>
  );
}
