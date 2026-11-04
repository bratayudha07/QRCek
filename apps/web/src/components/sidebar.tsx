import { PanelLeftClose, PanelLeftOpen, Pin } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { AppLink } from "./app-link";
import { NavIcon } from "./nav-icon";
import { Button } from "@/components/ui/button";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
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
 *
 * Built from the shadcn/ui `Sidebar` composition. The hover/focus expansion is
 * app behaviour layered on top of the official `open` state, and `SidebarInset`
 * (rendered by the caller) keeps the content aligned with the reserved rail
 * width. Mobile navigation stays in `BottomNav`.
 */
export function Sidebar({
  mode,
  route,
  collapsed,
  onToggle,
  children,
}: {
  mode: NavMode;
  route: AppRoute;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const items = sidebarItems(mode);
  const isMobile = useIsMobile();
  const sidebarRef = useRef<HTMLDivElement | null>(null);
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
    <SidebarProvider
      open={expanded}
      onOpenChange={togglePinnedState}
      style={
        {
          "--sidebar-width": "14.5rem",
          "--sidebar-width-icon": "4.5rem",
        } as CSSProperties
      }
    >
      <SidebarRoot
        ref={isMobile ? undefined : sidebarRef}
        id="app-sidebar"
        collapsible="icon"
        // The mobile branch renders a Sheet, so pointer/focus handlers only
        // apply to the desktop rail that actually expands on hover.
        {...(isMobile
          ? {}
          : {
              onPointerEnter: (event) => pointerEnter(event.pointerType),
              onPointerLeave: (event) => pointerLeave(event.pointerType),
              onFocusCapture: () => {
                clearCloseTimer();
                setFocusOpen(true);
                setSuppressAutoOpen(false);
              },
              onBlurCapture: (event) => handleBlur(event.relatedTarget),
            })}
        className={cn(
          // Capsule geometry: float the rail instead of spanning the viewport.
          "left-4 top-4 bottom-4 h-auto max-h-[calc(100dvh-2rem)]",
          // Keep the reserved gap at the rail width while the rail is pinned
          // collapsed, so the hover preview overlays the page instead of
          // reflowing it.
          collapsed && "[&>[data-slot=sidebar-gap]]:w-(--sidebar-width-icon)",
          "group-data-[side=left]:border-r-0 group-data-[side=right]:border-l-0",
          "[&>[data-slot=sidebar-inner]]:rounded-3xl",
          "[&>[data-slot=sidebar-inner]]:border [&>[data-slot=sidebar-inner]]:border-border/60",
          "[&>[data-slot=sidebar-inner]]:shadow-[0_18px_48px_-24px_rgba(15,23,42,0.34)]",
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

        <SidebarContent>
          <SidebarGroup className="p-2">
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarLink item={item} route={route} compact={compact} />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-2">
          <SidebarSeparator className="mx-0 mb-2 w-auto" />
          <PinToggle collapsed={collapsed} compact={compact} />
        </SidebarFooter>
      </SidebarRoot>
      {children}
    </SidebarProvider>
  );
}

function SidebarLink({
  item,
  route,
  compact,
}: {
  item: GlobalNavItem;
  route: AppRoute;
  compact: boolean;
}) {
  const active = isGlobalNavActive(item.key, route);

  return (
    <SidebarMenuButton
      render={
        <AppLink
          href={item.href}
          aria-current={active ? "page" : undefined}
          className="flex items-center gap-3"
        >
          <NavIcon
            name={item.key}
            className={cn(
              "size-5 shrink-0 transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              compact && "translate-x-[6px]",
            )}
          />
          <span className="truncate group-data-[collapsible=icon]:hidden">{item.label}</span>
        </AppLink>
      }
      isActive={active}
      tooltip={item.label}
      className={cn(
        "h-10 rounded-full px-3 text-sm font-medium",
        "group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!",
        active
          ? "bg-primary/10 font-semibold text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    />
  );
}

function PinToggle({ collapsed, compact }: { collapsed: boolean; compact: boolean }) {
  const { state, toggleSidebar } = useSidebar();
  const expanded = state === "expanded";

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={toggleSidebar}
      aria-expanded={expanded}
      aria-pressed={!collapsed}
      aria-controls="app-sidebar"
      title={collapsed ? "Sematkan sidebar terbuka" : "Ciutkan sidebar"}
      className="relative flex h-10 w-full items-center justify-start gap-3 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      {collapsed ? (
        compact ? (
          <PanelLeftOpen
            aria-hidden="true"
            className="size-5 shrink-0 translate-x-[6px] transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          />
        ) : (
          <Pin aria-hidden="true" className="size-4 shrink-0" />
        )
      ) : (
        <PanelLeftClose
          aria-hidden="true"
          className={cn(
            "size-5 shrink-0 transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            compact && "translate-x-[6px]",
          )}
        />
      )}
      <span
        className={cn(
          "pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 whitespace-nowrap transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          compact ? "translate-x-1 opacity-0" : "translate-x-0 opacity-100 delay-[80ms]",
        )}
      >
        {collapsed ? "Sematkan" : "Ciutkan"}
      </span>
    </Button>
  );
}
