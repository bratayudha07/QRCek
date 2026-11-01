import { describe, expect, it } from "vitest";

import {
  buildSheetRow,
  dataRowRange,
  headerRow,
  layoutRange,
  metadataRow,
  quoteSheetTab,
  SHEET_COLUMNS,
} from "./sheet-projection";

const attendance = {
  status: "present",
  checkedInAt: 1_760_000_000_000,
  method: "qr_scan",
  updatedAt: 1_760_000_000_000,
};

describe("sheet projection", () => {
  it("keeps the header and data row widths identical", () => {
    const row = buildSheetRow(
      { id: "01P", externalRef: "A-1", fullName: "Budi", category: "5A" },
      attendance,
    );

    expect(headerRow()).toEqual([...SHEET_COLUMNS]);
    expect(row).toHaveLength(SHEET_COLUMNS.length);
  });

  it("renders a participant without attendance with empty status cells", () => {
    const row = buildSheetRow(
      { id: "01P", externalRef: null, fullName: "Siti", category: null },
      null,
    );

    expect(row[0]).toBe("01P");
    expect(row[4]).toBe("");
    expect(row[5]).toBe("");
    expect(row[6]).toBe("");
    expect(row[7]).toBe("");
  });

  it("writes ISO timestamps in UTC", () => {
    const row = buildSheetRow(
      { id: "01P", externalRef: null, fullName: "Budi", category: null },
      attendance,
    );

    expect(row[5]).toBe("2025-10-09T08:53:20.000Z");
  });

  it("quotes tab names and escapes single quotes", () => {
    expect(quoteSheetTab("Absensi")).toBe("'Absensi'");
    expect(quoteSheetTab("Budi's Event")).toBe("'Budi''s Event'");
    expect(dataRowRange("Absensi", 3)).toBe("'Absensi'!A3:H3");
    expect(layoutRange("Absensi")).toBe("'Absensi'!A1:H2");
  });

  it("puts event metadata in row 1 and the schema version", () => {
    const row = metadataRow("01EVENT");
    expect(row[0]).toBe("event_id:01EVENT");
    expect(row[1]).toBe("schema_version:1");
    expect(row[2]).toBe("managed_by:absensi");
  });
});
