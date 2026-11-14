/**
 * Tiny path router for the SPA (no dependency).
 *
 * Tahap 3.5 splits the app into two navigation levels (AGENTS.md: global nav
 * and event nav are never merged), so the route tree now mirrors that:
 *
 *   /admin/dashboard
 *   /admin/events
 *   /admin/events/:eventId/{overview,participants,staff,attendance,reports,entitlements}
 *   /admin/events/:eventId/participants/import
 *   /admin/events/:eventId/participants/:participantId
 *   /admin/activity
 *   /admin/settings
 *   /staff/{home,scan,history,profile}
 *
 * Legacy paths (`/acara…`, `/akun`) are still parsed and are rewritten to their
 * canonical target by `routePath`, so old bookmarks keep working without
 * duplicating a second set of pages.
 *
 * Pure on purpose: the parsing rules are unit tested without a DOM, and the
 * hook in `use-route.ts` only wires `popstate` to them.
 */

export const EVENT_TAB_KEYS = [
  "overview",
  "participants",
  "staff",
  "attendance",
  "reports",
  "entitlements",
] as const;

export type EventTab = (typeof EVENT_TAB_KEYS)[number];

export type AppRoute =
  | { name: "home" }
  | { name: "dashboard" }
  | { name: "events" }
  | { name: "event"; eventId: string; tab: EventTab }
  | { name: "participant"; eventId: string; participantId: string }
  | { name: "import"; eventId: string }
  | { name: "labels"; eventId: string }
  | { name: "activity" }
  | { name: "settings" }
  | { name: "staffHome" }
  | { name: "staffScan" }
  | { name: "staffHistory" }
  | { name: "staffProfile" }
  | { name: "login" }
  | { name: "activation" }
  | { name: "notFound" };

/** Paths that never carry an id, kept in one place so links cannot drift. */
export const paths = {
  home: "/",
  dashboard: "/admin/dashboard",
  events: "/admin/events",
  activity: "/admin/activity",
  settings: "/admin/settings",
  staffHome: "/staff/home",
  staffScan: "/staff/scan",
  staffHistory: "/staff/history",
  staffProfile: "/staff/profile",
  login: "/masuk",
  activation: "/aktivasi",
} as const;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isEventTab(value: string): value is EventTab {
  return (EVENT_TAB_KEYS as readonly string[]).includes(value);
}

export function parseRoute(pathname: string): AppRoute {
  const segments = pathname.split("/").filter((segment) => segment !== "");

  if (segments.length === 0) return { name: "home" };

  const [first, second, third, fourth, fifth] = segments;

  if (first === "masuk" && segments.length === 1) return { name: "login" };
  if (first === "aktivasi" && segments.length === 1) return { name: "activation" };

  // Legacy paths from Tahap 3. Parsed to their canonical destination so a
  // stale bookmark still renders the right page before `routePath` rewrites it.
  if (first === "acara") {
    if (segments.length === 1) return { name: "events" };
    if (second === undefined) return { name: "notFound" };

    const eventId = decodeSegment(second);

    if (segments.length === 2) return { name: "event", eventId, tab: "overview" };
    if (segments.length === 3 && third === "impor") return { name: "import", eventId };
    if (segments.length === 4 && third === "peserta" && fourth !== undefined) {
      return { name: "participant", eventId, participantId: decodeSegment(fourth) };
    }

    return { name: "notFound" };
  }

  if (first === "akun" && segments.length === 1) return { name: "settings" };

  if (first === "admin") {
    if (segments.length === 1 || (segments.length === 2 && second === "dashboard")) {
      return { name: "dashboard" };
    }

    if (second === "events") {
      if (segments.length === 2) return { name: "events" };
      if (third === undefined) return { name: "notFound" };

      const eventId = decodeSegment(third);

      if (segments.length === 3) return { name: "event", eventId, tab: "overview" };

      if (segments.length === 4 && fourth !== undefined && isEventTab(fourth)) {
        return { name: "event", eventId, tab: fourth };
      }

      if (segments.length === 5 && fourth === "participants" && fifth !== undefined) {
        if (fifth === "import") return { name: "import", eventId };
        if (fifth === "labels") return { name: "labels", eventId };
        return { name: "participant", eventId, participantId: decodeSegment(fifth) };
      }

      return { name: "notFound" };
    }

    if (segments.length === 2 && second === "activity") return { name: "activity" };
    if (segments.length === 2 && second === "settings") return { name: "settings" };

    return { name: "notFound" };
  }

  if (first === "staff" && segments.length === 2) {
    if (second === "home") return { name: "staffHome" };
    if (second === "scan") return { name: "staffScan" };
    if (second === "history") return { name: "staffHistory" };
    if (second === "profile") return { name: "staffProfile" };
  }

  return { name: "notFound" };
}

export function eventTabPath(eventId: string, tab: EventTab): string {
  return `${paths.events}/${encodeURIComponent(eventId)}/${tab}`;
}

export function eventOverviewPath(eventId: string): string {
  return eventTabPath(eventId, "overview");
}

export function participantsPath(eventId: string): string {
  return eventTabPath(eventId, "participants");
}

export function participantPath(eventId: string, participantId: string): string {
  return `${participantsPath(eventId)}/${encodeURIComponent(participantId)}`;
}

export function importPath(eventId: string): string {
  return `${participantsPath(eventId)}/import`;
}

/** `/admin/events/:id/participants/labels` — QR label management and printing. */
export function labelsPath(eventId: string): string {
  return `${participantsPath(eventId)}/labels`;
}

/**
 * Canonical path for a route, or `null` when the route has no address (404).
 *
 * `use-route.ts` compares this with `location.pathname` and replaces the
 * history entry when they differ. That is the whole redirect mechanism: legacy
 * paths and `/admin/events/:id` (no tab) end up on the canonical URL without a
 * second page or a redirect route.
 */
export function routePath(route: AppRoute): string | null {
  switch (route.name) {
    case "home":
      return paths.home;
    case "dashboard":
      return paths.dashboard;
    case "events":
      return paths.events;
    case "event":
      return eventTabPath(route.eventId, route.tab);
    case "participant":
      return participantPath(route.eventId, route.participantId);
    case "import":
      return importPath(route.eventId);
    case "labels":
      return labelsPath(route.eventId);
    case "activity":
      return paths.activity;
    case "settings":
      return paths.settings;
    case "staffHome":
      return paths.staffHome;
    case "staffScan":
      return paths.staffScan;
    case "staffHistory":
      return paths.staffHistory;
    case "staffProfile":
      return paths.staffProfile;
    case "login":
      return paths.login;
    case "activation":
      return paths.activation;
    case "notFound":
      return null;
  }
}

/**
 * Client-side navigation. Falls back to a full load when `history` is absent
 * (tests, non-browser render) so callers never have to guard.
 */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (typeof window === "undefined") return;

  if (options.replace) {
    window.history.replaceState(null, "", path);
  } else {
    window.history.pushState(null, "", path);
  }

  window.dispatchEvent(new PopStateEvent("popstate"));
}
