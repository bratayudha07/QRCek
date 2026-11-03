import { EVENT_TABS } from "./navigation";
import type { EventTab } from "./router";

/**
 * Action list for the event command palette.
 *
 * Pure on purpose: "which actions does this term match" is a rule, so it is unit
 * tested without a DOM. The component only renders what this returns and
 * decides where `navigate` goes; no business rule lives in the view.
 */
export type PaletteAction =
  | { kind: "search"; id: "search"; label: string; term: string }
  | { kind: "tab"; id: `tab:${EventTab}`; label: string; tab: EventTab };

/** Case-insensitive, whitespace-tolerant match used by the list and the tests. */
export function matchesTerm(text: string, term: string): boolean {
  const query = term.trim().toLowerCase();
  return query === "" || text.toLowerCase().includes(query);
}

/**
 * Participant search first (when a term is typed), then every tab whose label
 * matches. The active tab is left out: jumping to the screen you are already on
 * is a dead action.
 *
 * The search action is offered even when no tab matches, because the Peserta tab
 * owns the real filtering and its own empty state — the palette never claims to
 * have searched anything by itself.
 */
export function paletteActions(term: string, activeTab?: EventTab | null): PaletteAction[] {
  const query = term.trim();

  const tabs = EVENT_TABS.filter((tab) => tab.key !== activeTab)
    .filter((tab) => matchesTerm(tab.label, query))
    .map<PaletteAction>((tab) => ({
      kind: "tab",
      id: `tab:${tab.key}`,
      label: tab.label,
      tab: tab.key,
    }));

  if (query === "") return tabs;

  return [
    { kind: "search", id: "search", label: `Cari “${query}” di Peserta`, term: query },
    ...tabs,
  ];
}
