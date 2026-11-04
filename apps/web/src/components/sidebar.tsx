import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";

import { AppLink } from "./app-link";
import { NavIcon } from "./nav-icon";
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
import {
  isGlobalNavActive,
  sidebarItems,
  type GlobalNavItem,
  type NavMode,
} from "@/lib/navigation";
import { paths, type AppRoute } from "@/lib/router";

/**
 * Desktop global navigation built from the stock shadcn/ui `Sidebar`
 * composition: the rail is docked to the viewport edge, uses the default
 * 16rem / 3rem widths, and only changes width when the user collapses it.
 * Mobile navigation stays in `BottomNav`.
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
  return (
    <SidebarProvider open={!collapsed} onOpenChange={onToggle}>
      <SidebarRoot id="app-sidebar" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="Absensi"
                render={<AppLink href={paths.home} />}
              >
                <img src="/brand-mark.svg" alt="" className="size-8 shrink-0 rounded-lg" />
                <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-semibold">Absensi</span>
                  <span className="truncate text-xs text-muted-foreground">QRCek</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {sidebarItems(mode).map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarLink item={item} route={route} />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarSeparator />
          <SidebarMenu>
            <SidebarMenuItem>
              <CollapseToggle collapsed={collapsed} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </SidebarRoot>
      {children}
    </SidebarProvider>
  );
}

function SidebarLink({ item, route }: { item: GlobalNavItem; route: AppRoute }) {
  const active = isGlobalNavActive(item.key, route);

  return (
    <SidebarMenuButton
      render={
        <AppLink href={item.href} aria-current={active ? "page" : undefined} />
      }
      isActive={active}
      tooltip={item.label}
    >
      <NavIcon name={item.key} />
      <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
    </SidebarMenuButton>
  );
}

function CollapseToggle({ collapsed }: { collapsed: boolean }) {
  const { toggleSidebar } = useSidebar();
  const label = collapsed ? "Buka sidebar" : "Ciutkan sidebar";

  return (
    <SidebarMenuButton
      tooltip={label}
      onClick={toggleSidebar}
      aria-controls="app-sidebar"
      aria-expanded={!collapsed}
      aria-pressed={!collapsed}
    >
      {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
      <span className="group-data-[collapsible=icon]:hidden">{label}</span>
    </SidebarMenuButton>
  );
}
