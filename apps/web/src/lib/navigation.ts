import type { Role } from "@absensi/shared";

import { paths, type AppRoute, type EventTab } from "./router";

/**
 * Pure navigation model: which items each role sees, where they point, and
 * which one is active for the current route.
 *
 * The components in `components/` only render what this file returns, so the
 * active-state rules and the two navigation levels can be unit tested without
 * a DOM.
 */

export type NavMode = "admin" | "staff";

export type GlobalNavKey =
  | "dashboard"
  | "events"
  | "activity"
  | "settings"
  | "staffHome"
  | "staffScan"
  | "staffHistory"
  | "staffProfile";

export interface GlobalNavItem {
  key: GlobalNavKey;
  label: string;
  href: string;
}

/** Global role decides the navigation set; the Worker still decides access. */
export function navMode(role: Role): NavMode {
  return role === "officer" ? "staff" : "admin";
}

const ADMIN_SIDEBAR: readonly GlobalNavItem[] = [
  { key: "dashboard", label: "Dashboard", href: paths.dashboard },
  { key: "events", label: "Acara", href: paths.events },
  { key: "activity", label: "Aktivitas", href: paths.activity },
  { key: "settings", label: "Pengaturan", href: paths.settings },
];

const ADMIN_BOTTOM: readonly GlobalNavItem[] = [
  { key: "dashboard", label: "Beranda", href: paths.dashboard },
  { key: "events", label: "Acara", href: paths.events },
  { key: "activity", label: "Aktivitas", href: paths.activity },
  { key: "settings", label: "Profil", href: paths.settings },
];

const STAFF_NAV: readonly GlobalNavItem[] = [
  { key: "staffHome", label: "Beranda", href: paths.staffHome },
  { key: "staffScan", label: "Scan QR", href: paths.staffScan },
  { key: "staffHistory", label: "Riwayat", href: paths.staffHistory },
  { key: "staffProfile", label: "Profil", href: paths.staffProfile },
];

export function sidebarItems(mode: NavMode): readonly GlobalNavItem[] {
  return mode === "admin" ? ADMIN_SIDEBAR : STAFF_NAV;
}

export function bottomNavItems(mode: NavMode): readonly GlobalNavItem[] {
  return mode === "admin" ? ADMIN_BOTTOM : STAFF_NAV;
}

/** The staff scan tab is the one visually primary destination. */
export function isPrimaryNavItem(key: GlobalNavKey): boolean {
  return key === "staffScan";
}

export function isGlobalNavActive(key: GlobalNavKey, route: AppRoute): boolean {
  switch (key) {
    case "dashboard":
      return route.name === "dashboard";
    case "events":
      return (
        route.name === "events" ||
        route.name === "event" ||
        route.name === "participant" ||
        route.name === "import" ||
        route.name === "labels"
      );
    case "activity":
      return route.name === "activity";
    case "settings":
      return route.name === "settings";
    case "staffHome":
      return (
        route.name === "staffHome" ||
        route.name === "event" ||
        route.name === "participant" ||
        route.name === "import" ||
        route.name === "labels"
      );
    case "staffScan":
      return route.name === "staffScan";
    case "staffHistory":
      return route.name === "staffHistory";
    case "staffProfile":
      return route.name === "staffProfile";
  }
}

export interface EventTabItem {
  key: EventTab;
  label: string;
}

export const EVENT_TABS: readonly EventTabItem[] = [
  { key: "overview", label: "Ringkasan" },
  { key: "activities", label: "Aktivitas" },
  { key: "participants", label: "Peserta" },
  { key: "staff", label: "Petugas" },
  { key: "attendance", label: "Absensi" },
  { key: "reports", label: "Laporan" },
  { key: "entitlements", label: "Hak" },
];

/** Event id carried by a route, or `null` outside an event workspace. */
export function eventIdOf(route: AppRoute): string | null {
  switch (route.name) {
    case "event":
    case "participant":
    case "import":
    case "labels":
      return route.eventId;
    default:
      return null;
  }
}

/** Which event tab a route belongs to; sub-pages count as their tab. */
export function eventTabForRoute(route: AppRoute): EventTab | null {
  switch (route.name) {
    case "event":
      return route.tab;
    case "participant":
    case "import":
    case "labels":
      return "participants";
    default:
      return null;
  }
}
