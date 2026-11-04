import * as Slot from "@radix-ui/react-slot";
import {
  createContext,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui sidebar composition. The desktop rail is the only variant this app
 * needs; mobile navigation stays in `BottomNav`, so the mobile sheet is not
 * included. `SidebarMenuButton` accepts `asChild`, which lets `AppLink` keep
 * its real `href` and SPA navigation.
 */

type SidebarState = "expanded" | "collapsed";

interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  state: SidebarState;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used inside <SidebarProvider>");
  return context;
}

export function SidebarProvider({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const value = useMemo<SidebarContextValue>(
    () => ({
      open,
      setOpen: onOpenChange,
      toggleSidebar: () => onOpenChange(!open),
      state: open ? "expanded" : "collapsed",
    }),
    [open, onOpenChange],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function Sidebar({ className, ...props }: ComponentProps<"aside">) {
  const { state } = useSidebar();

  return (
    <aside
      data-slot="sidebar"
      data-state={state}
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="sidebar-header" className={cn("flex flex-col", className)} {...props} />;
}

export function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cn("flex flex-col", className)} {...props} />;
}

export function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex w-full flex-col gap-1", className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn("relative", className)} {...props} />;
}

export function SidebarMenuButton({
  asChild,
  isActive,
  className,
  ...props
}: ComponentProps<"button"> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive ? "true" : undefined}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-full px-3 text-sm font-medium transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2",
        isActive
          ? "bg-primary/10 font-semibold text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenuBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="sidebar-menu-badge"
      className={cn(
        "ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarTrigger({
  className,
  children,
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const { toggleSidebar, state } = useSidebar();

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggleSidebar();
      }}
      data-slot="sidebar-trigger"
      data-state={state}
      className={cn("rounded-full", className)}
      {...props}
    >
      {children}
    </Button>
  );
}
