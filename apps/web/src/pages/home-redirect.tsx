import { useEffect } from "react";

import { ErrorState, LoadingState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { navMode } from "@/lib/navigation";
import { navigate, paths } from "@/lib/router";
import { useSession } from "@/lib/session";

/**
 * `/` — resolve to the role's home. The URL cannot know the role before the
 * session request returns, so the redirect happens here instead of in the pure
 * router.
 */
export function HomeRedirectPage() {
  const session = useSession();

  useEffect(() => {
    if (session.status === "anonymous") {
      navigate(paths.login, { replace: true });
    } else if (session.status === "authenticated") {
      navigate(
        navMode(session.user.role) === "staff" ? paths.staffHome : paths.dashboard,
        { replace: true },
      );
    }
  }, [session]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4">
      {session.status === "error" ? (
        <>
          <ErrorState message={session.message} />
          <div className="mt-3 flex justify-center">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Muat ulang
            </Button>
          </div>
        </>
      ) : (
        <LoadingState label="Menyiapkan…" />
      )}
    </div>
  );
}
