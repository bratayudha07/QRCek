import type { Role, UserSummary } from "@absensi/shared";
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
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

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Superadmin",
  event_admin: "Admin acara",
  officer: "Petugas",
};

/**
 * Desktop global navigation built from the stock shadcn/ui `Sidebar`
 * composition: a docked 16rem rail that collapses to icons, a branded header,
 * labelled navigation groups, and a footer with the signed-in user and the
 * collapse control. Mobile navigation stays in `BottomNav`.
 */
export function Sidebar({
  mode,
  route,
  user,
  collapsed,
  onToggle,
  children,
}: {
  mode: NavMode;
  route: AppRoute;
  user: UserSummary | null;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <SidebarProvider open={!collapsed} onOpenChange={onToggle}>
      <SidebarRoot id="app-sidebar" collapsible="icon" variant="sidebar">
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
            <SidebarGroupLabel>Menu</SidebarGroupLabel>
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
          <SidebarMenu>
            {user !== null && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  tooltip={user.displayName}
                  render={
                    <AppLink
                      href={mode === "admin" ? paths.settings : paths.staffProfile}
                      aria-current={isAccountActive(mode, route) ? "page" : undefined}
                    />
                  }
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground"
                  >
                    {initials(user.displayName)}
                  </span>
                  <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-medium">{user.displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {ROLE_LABEL[user.role]}
                    </span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
          <SidebarSeparator />
          <SidebarMenu>
            <SidebarMenuItem>
              <CollapseToggle collapsed={collapsed} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </SidebarRoot>
      {children}
    </SidebarProvider>
  );
}

function SidebarLink({ item, route }: { item: GlobalNavItem; route: AppRoute }) {
  const active = isGlobalNavActive(item.key, route);

  return (
    <SidebarMenuButton
      render={<AppLink href={item.href} aria-current={active ? "page" : undefined} />}
      isActive={active}
      tooltip={item.label}
      className="h-10 gap-3 px-3 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center [&_svg]:size-5"
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
      className="h-10 gap-3 px-3 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center [&_svg]:size-5"
    >
      {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
      <span className="group-data-[collapsible=icon]:hidden">{label}</span>
    </SidebarMenuButton>
  );
}

function isAccountActive(mode: NavMode, route: AppRoute) {
  return mode === "admin" ? route.name === "settings" : route.name === "staffProfile";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
