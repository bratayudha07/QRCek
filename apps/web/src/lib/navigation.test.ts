import { describe, expect, it } from "vitest";

import type { AppRoute } from "./router";
import {
  EVENT_TABS,
  bottomNavItems,
  eventIdOf,
  eventTabForRoute,
  isGlobalNavActive,
  isPrimaryNavItem,
  navMode,
  sidebarItems,
} from "./navigation";

const overview: AppRoute = { name: "event", eventId: "EVT", tab: "overview" };
const activities: AppRoute = { name: "event", eventId: "EVT", tab: "activities" };
const participants: AppRoute = { name: "event", eventId: "EVT", tab: "participants" };
const participant: AppRoute = {
  name: "participant",
  eventId: "EVT",
  participantId: "P1",
};
const importRoute: AppRoute = { name: "import", eventId: "EVT" };
const labelsRoute: AppRoute = { name: "labels", eventId: "EVT" };

describe("navMode", () => {
  it("gives officers the staff set and everyone else the admin set", () => {
    expect(navMode("officer")).toBe("staff");
    expect(navMode("event_admin")).toBe("admin");
    expect(navMode("superadmin")).toBe("admin");
  });
});

describe("navigation items", () => {
  it("lists the admin sidebar destinations in order", () => {
    expect(sidebarItems("admin").map((item) => item.label)).toEqual([
      "Dashboard",
      "Acara",
      "Aktivitas",
      "Pengaturan",
    ]);
  });

  it("lists the admin bottom destinations in order", () => {
    expect(bottomNavItems("admin").map((item) => item.label)).toEqual([
      "Beranda",
      "Acara",
      "Aktivitas",
      "Profil",
    ]);
  });

  it("lists the staff destinations in order", () => {
    expect(sidebarItems("staff").map((item) => item.label)).toEqual([
      "Beranda",
      "Scan QR",
      "Riwayat",
      "Profil",
    ]);
    expect(bottomNavItems("staff").map((item) => item.label)).toEqual([
      "Beranda",
      "Scan QR",
      "Riwayat",
      "Profil",
    ]);
  });

  it("marks only Scan QR as the primary staff action", () => {
    expect(isPrimaryNavItem("staffScan")).toBe(true);
    expect(isPrimaryNavItem("staffHome")).toBe(false);
    expect(isPrimaryNavItem("events")).toBe(false);
  });
});

describe("isGlobalNavActive", () => {
  it("keeps Acara active across the whole event workspace", () => {
    expect(isGlobalNavActive("events", { name: "events" })).toBe(true);
    expect(isGlobalNavActive("events", overview)).toBe(true);
    expect(isGlobalNavActive("events", participants)).toBe(true);
    expect(isGlobalNavActive("events", participant)).toBe(true);
    expect(isGlobalNavActive("events", importRoute)).toBe(true);
    expect(isGlobalNavActive("events", labelsRoute)).toBe(true);
    expect(isGlobalNavActive("events", { name: "dashboard" })).toBe(false);
  });

  it("maps each simple destination to itself", () => {
    expect(isGlobalNavActive("dashboard", { name: "dashboard" })).toBe(true);
    expect(isGlobalNavActive("activity", { name: "activity" })).toBe(true);
    expect(isGlobalNavActive("settings", { name: "settings" })).toBe(true);
    expect(isGlobalNavActive("staffHome", { name: "staffHome" })).toBe(true);
    expect(isGlobalNavActive("staffHome", overview)).toBe(true);
    expect(isGlobalNavActive("staffHome", labelsRoute)).toBe(true);
    expect(isGlobalNavActive("staffHome", { name: "events" })).toBe(false);
    expect(isGlobalNavActive("staffScan", { name: "staffScan" })).toBe(true);
    expect(isGlobalNavActive("staffHistory", { name: "staffHistory" })).toBe(true);
    expect(isGlobalNavActive("staffProfile", { name: "staffProfile" })).toBe(true);
  });
});

describe("event context", () => {
  it("extracts the event id only inside a workspace", () => {
    expect(eventIdOf(overview)).toBe("EVT");
    expect(eventIdOf(participant)).toBe("EVT");
    expect(eventIdOf(importRoute)).toBe("EVT");
    expect(eventIdOf(labelsRoute)).toBe("EVT");
    expect(eventIdOf({ name: "events" })).toBeNull();
    expect(eventIdOf({ name: "dashboard" })).toBeNull();
  });

  it("maps the current tab, counting sub-pages as Peserta", () => {
    expect(eventTabForRoute(overview)).toBe("overview");
    expect(eventTabForRoute(activities)).toBe("activities");
    expect(eventTabForRoute(participants)).toBe("participants");
    expect(eventTabForRoute(participant)).toBe("participants");
    expect(eventTabForRoute(importRoute)).toBe("participants");
    expect(eventTabForRoute(labelsRoute)).toBe("participants");
    expect(eventTabForRoute({ name: "events" })).toBeNull();
  });

  it("keeps the seven event tabs in the agreed order", () => {
    expect(EVENT_TABS.map((tab) => tab.label)).toEqual([
      "Ringkasan",
      "Aktivitas",
      "Peserta",
      "Petugas",
      "Absensi",
      "Laporan",
      "Hak",
    ]);
  });
});
