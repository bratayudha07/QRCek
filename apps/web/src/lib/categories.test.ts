import type { CategorySummary } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  categoriesPath,
  categoryOptionLabel,
  categoryParticipantLabel,
  categoryPath,
  categorySelectOptions,
  categoryStatusLabel,
  categoryStatusPath,
  sortCategories,
} from "./categories";

/** Pure helpers stay unit-tested so the UI cannot drift from the Worker routes. */

function category(overrides: Partial<CategorySummary> = {}): CategorySummary {
  return {
    id: "cat-1",
    themeId: "evt-1",
    name: "Kelas 5A",
    description: null,
    sortOrder: 0,
    status: "active",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    archivedAt: null,
    ...overrides,
  };
}

describe("category paths", () => {
  it("omits the default status and encodes ids", () => {
    expect(categoriesPath("evt 1")).toBe("/api/events/evt%201/categories");
    expect(categoriesPath("evt", "active")).toBe("/api/events/evt/categories");
    expect(categoriesPath("evt", "archived")).toBe(
      "/api/events/evt/categories?status=archived",
    );
    expect(categoriesPath("evt", "all")).toBe("/api/events/evt/categories?status=all");
  });

  it("builds detail and status paths under the Tema", () => {
    expect(categoryPath("evt", "cat/1")).toBe("/api/events/evt/categories/cat%2F1");
    expect(categoryStatusPath("evt", "cat 1")).toBe(
      "/api/events/evt/categories/cat%201/status",
    );
  });
});

describe("categoryStatusLabel", () => {
  it("maps both statuses to Indonesian labels", () => {
    expect(categoryStatusLabel("active")).toBe("Aktif");
    expect(categoryStatusLabel("archived")).toBe("Diarsipkan");
  });
});

describe("categoryOptionLabel", () => {
  it("adds the participant count only when the API sent one", () => {
    expect(categoryOptionLabel(category())).toBe("Kelas 5A");
    expect(categoryOptionLabel(category({ participantCount: 0 }))).toBe("Kelas 5A (0 peserta)");
    expect(categoryOptionLabel(category({ participantCount: 12 }))).toBe("Kelas 5A (12 peserta)");
  });

  it("formats the table count column", () => {
    expect(categoryParticipantLabel(undefined)).toBe("—");
    expect(categoryParticipantLabel(7)).toBe("7 peserta");
  });
});

describe("sortCategories", () => {
  it("orders by sortOrder then name without mutating the input", () => {
    const input = [
      category({ id: "b", name: "B", sortOrder: 2 }),
      category({ id: "a", name: "A", sortOrder: 1 }),
      category({ id: "c", name: "C", sortOrder: 1 }),
    ];

    expect(sortCategories(input).map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(input.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});

describe("categorySelectOptions", () => {
  it("offers only active categories for a new participant", () => {
    const options = categorySelectOptions([
      category({ id: "a", name: "A", status: "active" }),
      category({ id: "z", name: "Z", status: "archived" }),
    ]);

    expect(options).toEqual([{ value: "a", label: "A", archived: false }]);
  });

  it("keeps the selected archived category selectable while editing", () => {
    const options = categorySelectOptions(
      [
        category({ id: "a", name: "A", status: "active" }),
        category({ id: "z", name: "Z", status: "archived" }),
      ],
      "z",
    );

    expect(options).toEqual([
      { value: "a", label: "A", archived: false },
      { value: "z", label: "Z (diarsipkan)", archived: true },
    ]);
  });

  it("does not duplicate the selected category when it is active", () => {
    const options = categorySelectOptions([category({ id: "a", name: "A" })], "a");
    expect(options).toHaveLength(1);
    expect(options[0]?.archived).toBe(false);
  });

  it("returns nothing when the Tema has no active category", () => {
    expect(categorySelectOptions([category({ id: "z", status: "archived" })])).toEqual([]);
    expect(categorySelectOptions([])).toEqual([]);
  });
});
