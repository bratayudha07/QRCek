import { describe, expect, it } from "vitest";

import {
  EVENT_TAB_KEYS,
  eventTabPath,
  importPath,
  labelsPath,
  parseRoute,
  participantPath,
  participantsPath,
  paths,
  routePath,
} from "./router";

describe("parseRoute", () => {
  it.each([
    ["/", "home"],
    [paths.dashboard, "dashboard"],
    [paths.events, "events"],
    [paths.activity, "activity"],
    [paths.settings, "settings"],
    [paths.staffHome, "staffHome"],
    [paths.staffScan, "staffScan"],
    [paths.staffHistory, "staffHistory"],
    [paths.staffProfile, "staffProfile"],
    [paths.login, "login"],
    [paths.activation, "activation"],
  ] as const)("maps %s to %s", (path, name) => {
    expect(parseRoute(path).name).toBe(name);
  });

  it("treats bare /admin as the dashboard", () => {
    expect(parseRoute("/admin")).toEqual({ name: "dashboard" });
  });

  it.each(EVENT_TAB_KEYS)("parses the %s event tab", (tab) => {
    expect(parseRoute(`/admin/events/01JEVENT/${tab}`)).toEqual({
      name: "event",
      eventId: "01JEVENT",
      tab,
    });
  });

  it("exposes the six event tabs including Hak", () => {
    expect(EVENT_TAB_KEYS).toHaveLength(6);
    expect(EVENT_TAB_KEYS).toContain("entitlements");
  });

  it("defaults an event URL without a tab to the overview", () => {
    expect(parseRoute("/admin/events/01JEVENT")).toEqual({
      name: "event",
      eventId: "01JEVENT",
      tab: "overview",
    });
  });

  it("parses participant detail and the import wizard", () => {
    expect(parseRoute("/admin/events/01JEVENT/participants/01JPART")).toEqual({
      name: "participant",
      eventId: "01JEVENT",
      participantId: "01JPART",
    });

    expect(parseRoute("/admin/events/01JEVENT/participants/import")).toEqual({
      name: "import",
      eventId: "01JEVENT",
    });

    expect(parseRoute("/admin/events/01JEVENT/participants/labels")).toEqual({
      name: "labels",
      eventId: "01JEVENT",
    });
  });

  it("keeps legacy Tahap 3 paths working", () => {
    expect(parseRoute("/acara")).toEqual({ name: "events" });
    expect(parseRoute("/akun")).toEqual({ name: "settings" });
    expect(parseRoute("/acara/01JEVENT")).toEqual({
      name: "event",
      eventId: "01JEVENT",
      tab: "overview",
    });
    expect(parseRoute("/acara/01JEVENT/impor")).toEqual({
      name: "import",
      eventId: "01JEVENT",
    });
    expect(parseRoute("/acara/01JEVENT/peserta/01JPART")).toEqual({
      name: "participant",
      eventId: "01JEVENT",
      participantId: "01JPART",
    });
  });

  it("ignores trailing slashes", () => {
    expect(parseRoute("/admin/events/")).toEqual({ name: "events" });
    expect(parseRoute("/admin/events/EVT/")).toEqual({
      name: "event",
      eventId: "EVT",
      tab: "overview",
    });
    expect(parseRoute("/acara/")).toEqual({ name: "events" });
  });

  it("decodes URL-encoded ids", () => {
    expect(parseRoute("/admin/events/a%20b/overview")).toEqual({
      name: "event",
      eventId: "a b",
      tab: "overview",
    });
    expect(parseRoute("/acara/a%20b")).toEqual({
      name: "event",
      eventId: "a b",
      tab: "overview",
    });
  });

  it.each([
    "/foo",
    "/admin/events/EVT/lain",
    "/admin/events/EVT/staff/extra",
    "/admin/events/EVT/participants/import/extra",
    "/admin/activity/extra",
    "/acara/EVT/peserta",
    "/acara/EVT/lain",
    "/akun/extra",
    "/staff",
    "/staff/home/extra",
  ])("returns notFound for %s", (path) => {
    expect(parseRoute(path)).toEqual({ name: "notFound" });
  });
});

describe("routePath", () => {
  it("builds canonical paths", () => {
    expect(eventTabPath("EVT", "overview")).toBe("/admin/events/EVT/overview");
    expect(participantsPath("EVT")).toBe("/admin/events/EVT/participants");
    expect(participantPath("EVT", "P1")).toBe("/admin/events/EVT/participants/P1");
    expect(importPath("EVT")).toBe("/admin/events/EVT/participants/import");
    expect(labelsPath("EVT")).toBe("/admin/events/EVT/participants/labels");
  });

  it("encodes ids in generated paths", () => {
    expect(eventTabPath("a/b", "participants")).toBe("/admin/events/a%2Fb/participants");
    expect(participantPath("a/b", "c/d")).toBe("/admin/events/a%2Fb/participants/c%2Fd");
  });

  it("rewrites legacy and partial paths to their canonical address", () => {
    expect(routePath(parseRoute("/acara"))).toBe(paths.events);
    expect(routePath(parseRoute("/akun"))).toBe(paths.settings);
    expect(routePath(parseRoute("/acara/EVT"))).toBe("/admin/events/EVT/overview");
    expect(routePath(parseRoute("/acara/EVT/impor"))).toBe(
      "/admin/events/EVT/participants/import",
    );
    expect(routePath(parseRoute("/admin/events/EVT"))).toBe("/admin/events/EVT/overview");
    expect(routePath(parseRoute("/admin"))).toBe(paths.dashboard);
  });

  it("has no canonical address for a 404", () => {
    expect(routePath(parseRoute("/foo"))).toBeNull();
  });
});
