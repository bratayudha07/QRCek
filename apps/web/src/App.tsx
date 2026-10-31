import { ActivationPage } from "@/pages/activation";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";

/**
 * App shell with a deliberately tiny router.
 *
 * Three static screens do not justify a routing dependency (AGENTS.md: every
 * package must justify itself). `wrangler`'s SPA fallback already serves
 * `index.html` for these paths; this only picks the component. If routing grows
 * query params, nested layouts, or transitions, revisit the dependency.
 */
function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

export default function App() {
  const path = currentPath();

  if (path === "/aktivasi") return <ActivationPage />;
  if (path === "/masuk") return <LoginPage />;

  return <HomePage />;
}
