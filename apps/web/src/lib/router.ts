/**
 * Tiny path router for the SPA (no dependency).
 *
 * `App.tsx` used to switch on three literal paths. Tahap 3 adds nested routes
 * with ids, which is still a dozen lines of parsing — not enough to justify a
 * router package (AGENTS.md: every dependency must justify itself).
 *
 * Pure on purpose: the parsing rules are unit tested without a DOM, and the
 * hook in `use-route.ts` only wires `popstate` to them.
 */

export type AppRoute =
  | { name: "events" }
  | { name: "event"; eventId: string }
  | { name: "participant"; eventId: string; participantId: string }
  | { name: "import"; eventId: string }
  | { name: "account" }
  | { name: "login" }
  | { name: "activation" }
  | { name: "notFound" };

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseRoute(pathname: string): AppRoute {
  const segments = pathname.split("/").filter((segment) => segment !== "");

  if (segments.length === 0) return { name: "events" };

  const [first, second, third, fourth] = segments;

  if (first === "akun" && segments.length === 1) return { name: "account" };
  if (first === "masuk" && segments.length === 1) return { name: "login" };
  if (first === "aktivasi" && segments.length === 1) return { name: "activation" };

  if (first === "acara") {
    if (segments.length === 1) return { name: "events" };
    if (second === undefined) return { name: "notFound" };

    const eventId = decodeSegment(second);

    if (segments.length === 2) return { name: "event", eventId };
    if (segments.length === 3 && third === "impor") return { name: "import", eventId };
    if (segments.length === 4 && third === "peserta" && fourth !== undefined) {
      return { name: "participant", eventId, participantId: decodeSegment(fourth) };
    }
  }

  return { name: "notFound" };
}

/** Base path of an event, used by links and redirects. */
export function eventPath(eventId: string): string {
  return `/acara/${encodeURIComponent(eventId)}`;
}

export function participantPath(eventId: string, participantId: string): string {
  return `${eventPath(eventId)}/peserta/${encodeURIComponent(participantId)}`;
}

export function importPath(eventId: string): string {
  return `${eventPath(eventId)}/impor`;
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
