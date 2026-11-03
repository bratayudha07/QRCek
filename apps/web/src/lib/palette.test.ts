import { describe, expect, it } from "vitest";

import { matchesTerm, paletteActions, type PaletteAction } from "./palette";

const labels = (actions: PaletteAction[]) => actions.map((action) => action.label);
const tabLabels = (actions: PaletteAction[]) =>
  actions.filter((action) => action.kind === "tab").map((action) => action.label);

describe("matchesTerm", () => {
  it("treats an empty or blank term as a match", () => {
    expect(matchesTerm("Laporan", "")).toBe(true);
    expect(matchesTerm("Laporan", "   ")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(matchesTerm("Laporan", "  LAP ")).toBe(true);
    expect(matchesTerm("laporan", "POR")).toBe(true);
  });

  it("rejects labels that do not contain the term", () => {
    expect(matchesTerm("Laporan", "peserta")).toBe(false);
  });
});

describe("paletteActions", () => {
  it("lists the tabs without asking for a search when nothing is typed", () => {
    const actions = paletteActions("");

    expect(actions.every((action) => action.kind === "tab")).toBe(true);
    expect(labels(actions)).toEqual(["Ringkasan", "Peserta", "Petugas", "Absensi", "Laporan"]);
  });

  it("leaves out the tab the user is already on", () => {
    expect(tabLabels(paletteActions("", "staff"))).toEqual([
      "Ringkasan",
      "Peserta",
      "Absensi",
      "Laporan",
    ]);
  });

  it("offers the trimmed participant search first, then the matching tabs", () => {
    const actions = paletteActions("  lap  ");

    expect(actions[0]).toMatchObject({ kind: "search", term: "lap" });
    expect(actions[0]?.label).toBe("Cari “lap” di Peserta");
    expect(tabLabels(actions)).toEqual(["Laporan"]);
  });

  it("keeps the participant search when no tab matches", () => {
    const actions = paletteActions("zzz");

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "search", term: "zzz" });
  });

  it("does not invent destinations: every tab action targets an existing tab", () => {
    for (const action of paletteActions("")) {
      expect(action.kind).toBe("tab");
      expect(action.id).toMatch(/^tab:(overview|participants|staff|attendance|reports)$/);
    }
  });
});
