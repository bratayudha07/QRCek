import { useEffect, useState } from "react";

import { parseRoute, routePath, type AppRoute } from "./router";

/**
 * Current route, re-rendered on `pushState` navigation and browser back.
 *
 * The effect also canonicalises the address bar: legacy `/acara…` and `/akun`
 * paths, `/admin/events/:id` without a tab, and trailing slashes are replaced
 * with the canonical path (never pushed), so there is exactly one URL per
 * screen. Search and hash are preserved because they are not part of routing
 * (`/aktivasi#t=…` must keep its fragment).
 */
export function useRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    function sync() {
      const next = parseRoute(window.location.pathname);
      const canonical = routePath(next);

      if (canonical !== null && canonical !== window.location.pathname) {
        window.history.replaceState(
          null,
          "",
          `${canonical}${window.location.search}${window.location.hash}`,
        );
      }

      setRoute(next);
    }

    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return route;
}
