import type { MembershipSummary, UserSummary } from "@absensi/shared";
import { useEffect, useState } from "react";

import { fetchMe } from "./auth";

/**
 * Session state for the SPA.
 *
 * This is a UX cache only: every request is still authorized by the Worker
 * against the session cookie. Hiding a button here never protects anything.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: UserSummary; memberships: MembershipSummary[] }
  | { status: "error"; message: string };

/**
 * Concurrent mounts (the navigation frame and the page it wraps) share one
 * `/api/auth/me` request. Only in-flight requests are shared: the result is not
 * cached, so logging out or switching users can never read a stale session.
 */
let inFlight: ReturnType<typeof fetchMe> | null = null;

function loadSession(): ReturnType<typeof fetchMe> {
  if (inFlight === null) {
    inFlight = fetchMe().finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}

export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    loadSession()
      .then((body) => {
        if (cancelled) return;

        if (body.ok) {
          setSession({
            status: "authenticated",
            user: body.data.user,
            memberships: body.data.memberships,
          });
        } else if (body.error.code === "UNAUTHENTICATED") {
          setSession({ status: "anonymous" });
        } else {
          setSession({ status: "error", message: body.error.message });
        }
      })
      .catch(() => {
        if (!cancelled) setSession({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return session;
}
