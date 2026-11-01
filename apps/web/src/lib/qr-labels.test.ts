import type { LabelFieldKey } from "@absensi/shared";
import { A4_LABELS_PER_PAGE, MAX_LABEL_FIELDS } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  labelPrintCss,
  moveLabelField,
  orderedLabelValues,
  paginateLabels,
  toggleLabelField,
} from "./qr-labels";

/**
 * Pure helpers behind the label page. Node-only on purpose: the project has no
 * jsdom/testing-library, so layout and print behaviour is verified manually and
 * reported as NOT RUN, while the ordering/pagination rules are covered here.
 */

describe("toggleLabelField", () => {
  it("adds and removes fields", () => {
    expect(toggleLabelField(["fullName"], "category")).toEqual(["fullName", "category"]);
    expect(toggleLabelField(["fullName", "category"], "fullName")).toEqual(["category"]);
  });

  it("keeps at least one field", () => {
    expect(toggleLabelField(["fullName"], "fullName")).toEqual(["fullName"]);
  });

  it("refuses a fifth field", () => {
    const fields: LabelFieldKey[] = ["fullName", "externalRef", "category", "phone"];
    expect(fields).toHaveLength(MAX_LABEL_FIELDS);
    expect(toggleLabelField(fields, "email")).toEqual(fields);
  });
});

describe("moveLabelField", () => {
  const fields: LabelFieldKey[] = ["fullName", "externalRef", "category"];

  it("reorders without mutating the input", () => {
    expect(moveLabelField(fields, "category", -1)).toEqual(["fullName", "category", "externalRef"]);
    expect(moveLabelField(fields, "fullName", 1)).toEqual(["externalRef", "fullName", "category"]);
    expect(fields).toEqual(["fullName", "externalRef", "category"]);
  });

  it("does nothing at the edges or for an unknown field", () => {
    expect(moveLabelField(fields, "fullName", -1)).toEqual(fields);
    expect(moveLabelField(fields, "category", 1)).toEqual(fields);
    expect(moveLabelField(fields, "email", -1)).toEqual(fields);
  });
});

describe("orderedLabelValues", () => {
  it("follows the configured order and drops empty values", () => {
    const values = {
      fullName: "Siti",
      category: "Kelas 7",
      externalRef: "",
    };

    expect(orderedLabelValues(["category", "fullName", "externalRef", "note"], values)).toEqual([
      "Kelas 7",
      "Siti",
    ]);
  });

  it("trims values before deciding they are empty", () => {
    expect(orderedLabelValues(["phone"], { phone: "   " })).toEqual([]);
    expect(orderedLabelValues(["phone"], { phone: " 0812 " })).toEqual(["0812"]);
  });
});

describe("paginateLabels", () => {
  const labels = Array.from({ length: 50 }, (_, index) => `p-${index}`);

  it("splits A4 labels into pages of 24", () => {
    const pages = paginateLabels(labels, A4_LABELS_PER_PAGE);

    expect(pages.map((page) => page.length)).toEqual([24, 24, 2]);
    expect(pages.flat()).toEqual(labels);
  });

  it("handles an exact multiple and an empty list", () => {
    expect(paginateLabels(labels.slice(0, 48), 24).map((page) => page.length)).toEqual([24, 24]);
    expect(paginateLabels([], 24)).toEqual([]);
  });
});

describe("labelPrintCss", () => {
  it("uses A4 portrait with a 3-column grid for the sheet format", () => {
    const css = labelPrintCss("a4");

    expect(css).toContain("size: A4 portrait");
    expect(css).toContain("margin: 8mm");
    expect(css).toContain("repeat(3");
    expect(css).toContain("194mm");
  });

  it("uses the exact 50 × 30 mm medium for stickers", () => {
    const css = labelPrintCss("sticker");

    expect(css).toContain("size: 50mm 30mm");
    expect(css).toContain("margin: 0");
    expect(css).toContain("width: 50mm");
    expect(css).toContain("height: 30mm");
  });
});
