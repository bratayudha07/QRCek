import { useEffect, useState } from "react";

import { parseRoute, type AppRoute } from "./router";

/** Current route, re-rendered on `pushState` navigation and browser back. */
export function useRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    function sync() {
      setRoute(parseRoute(window.location.pathname));
    }

    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return route;
}
