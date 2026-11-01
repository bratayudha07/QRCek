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

export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetchMe()
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
