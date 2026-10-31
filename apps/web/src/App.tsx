import { HomePage } from "@/pages/home";

/**
 * App shell.
 *
 * Routing arrives with the first screen that needs it. Until then this file
 * stays a thin composition root so pages remain independently testable.
 */
export default function App() {
  return <HomePage />;
}
