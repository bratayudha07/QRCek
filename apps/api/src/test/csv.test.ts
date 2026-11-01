import { describe, expect, it } from "vitest";

import { CsvFormatError, buildCsv, detectDelimiter, escapeCsvCell, parseCsv } from "../domain/csv";
import {
  normalizeEmail,
  normalizePhone,
  parseParticipantCsv,
  participantTemplateCsv,
} from "../domain/participant-import";

/** Parser edge cases (IMPLEMENTATION_PLAN.md Fase 2: ≥ 15 cases). */

describe("parseCsv", () => {
  it("keeps a comma inside quotes as data", () => {
    const rows = parseCsv('full_name,note\n"Budi, S.Pd",guru');
    expect(rows[1]?.values).toEqual(["Budi, S.Pd", "guru"]);
  });

  it("supports newlines inside quotes and keeps the record start line", () => {
    const rows = parseCsv('full_name,note\n"Budi","baris satu\nbaris dua"\nSiti,oke');
    expect(rows[1]?.values[1]).toBe("baris satu\nbaris dua");
    expect(rows[1]?.line).toBe(2);
    expect(rows[2]?.line).toBe(4);
  });

  it("strips a UTF-8 BOM", () => {
    const rows = parseCsv("\uFEFFfull_name\nBudi");
    expect(rows[0]?.values).toEqual(["full_name"]);
    expect(rows[1]?.values).toEqual(["Budi"]);
  });

  it("detects a semicolon delimiter", () => {
    expect(detectDelimiter("full_name;phone\nBudi;0812")).toBe(";");
    const rows = parseCsv("full_name;phone\nBudi;0812");
    expect(rows[1]?.values).toEqual(["Budi", "0812"]);
  });

  it("skips blank rows", () => {
    const rows = parseCsv("full_name\n\nBudi\n\nSiti\n");
    expect(rows.map((row) => row.values[0])).toEqual(["full_name", "Budi", "Siti"]);
  });

  it("unescapes doubled quotes", () => {
    const rows = parseCsv('full_name\n"Budi ""Bud"" Santoso"');
    expect(rows[1]?.values).toEqual(['Budi "Bud" Santoso']);
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsv("full_name,phone\r\nBudi,0812\r\nSiti,0813\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]?.values).toEqual(["Budi", "0812"]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('full_name\n"Budi')).toThrow(CsvFormatError);
  });
});

describe("participant CSV validation", () => {
  it("normalizes names, Indonesian phones, and emails", () => {
    const result = parseParticipantCsv(
      [
        "external_ref,full_name,phone,email,category,note",
        'A-1,  Budi   Santoso  ,0812-3456-7890,BUDI@Example.COM, Kelas 5A ,catatan',
      ].join("\n"),
    );

    expect(result.invalid).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      externalRef: "A-1",
      fullName: "Budi Santoso",
      phone: "+6281234567890",
      email: "budi@example.com",
      category: "Kelas 5A",
      note: "catatan",
    });
  });

  it("requires the full_name header", () => {
    expect(() => parseParticipantCsv("external_ref,phone\nA-1,0812")).toThrow(
      /Header wajib "full_name"/i,
    );
  });

  it("rejects duplicate headers", () => {
    expect(() => parseParticipantCsv("full_name,full_name\nBudi,Budi")).toThrow(/duplikat/i);
  });

  it("rejects unknown headers instead of silently dropping data", () => {
    expect(() => parseParticipantCsv("full_name,nis\nBudi,123")).toThrow(/tidak dikenal/i);
  });

  it("reports duplicate external_ref within the file", () => {
    const result = parseParticipantCsv(
      "external_ref,full_name\nA-1,Budi\nA-1,Siti",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.invalid).toEqual([
      { line: 3, reason: "external_ref duplikat di dalam file" },
    ]);
  });

  it("reports the same name + phone twice as a likely duplicate", () => {
    const result = parseParticipantCsv(
      "full_name,phone\nBudi,081234567890\nBudi,0812 3456 7890",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.invalid[0]?.reason).toMatch(/duplikat/i);
  });

  it("reports an invalid phone with the physical line", () => {
    const result = parseParticipantCsv("full_name,phone\nBudi,abc");
    expect(result.invalid).toEqual([
      { line: 2, reason: "nomor telepon hanya boleh berisi angka dan +" },
    ]);
  });

  it("reports an invalid email", () => {
    const result = parseParticipantCsv("full_name,email\nBudi,bukan-email");
    expect(result.invalid[0]?.reason).toMatch(/email/i);
  });

  it("reports a name longer than 120 characters", () => {
    const result = parseParticipantCsv(`full_name\n${"a".repeat(121)}`);
    expect(result.invalid[0]?.reason).toMatch(/120/);
  });

  it("rejects a row with more cells than the header", () => {
    const result = parseParticipantCsv("full_name\nBudi,extra");
    expect(result.invalid[0]?.reason).toMatch(/jumlah kolom/i);
  });

  it("allows missing trailing optional cells", () => {
    const result = parseParticipantCsv("full_name,phone,email\nBudi");
    expect(result.rows[0]).toMatchObject({ fullName: "Budi", phone: null, email: null });
  });

  it("enforces the 1,000-row import limit", () => {
    const lines = ["full_name"];
    for (let i = 0; i < 1_001; i += 1) lines.push(`Peserta ${i}`);
    expect(() => parseParticipantCsv(lines.join("\n"))).toThrow(/batas per import/i);
  });
});

describe("phone normalization", () => {
  it.each([
    ["0812-3456-7890", "+6281234567890"],
    ["+62 812 3456 7890", "+6281234567890"],
    ["6281234567890", "+6281234567890"],
    ["81234567890", "+6281234567890"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhone(input)).toEqual({ value: expected });
  });

  it("returns null for an empty value", () => {
    expect(normalizePhone("  ")).toEqual({ value: null });
  });

  it("rejects international numbers that are too short", () => {
    expect(normalizePhone("+123").error).toBeDefined();
  });
});

describe("email normalization", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Budi@Example.COM ")).toEqual({ value: "budi@example.com" });
  });
});

describe("CSV writer", () => {
  it("quotes commas, quotes, and newlines", () => {
    expect(escapeCsvCell('Budi, "Bud"\nSantoso')).toBe('"Budi, ""Bud""\nSantoso"');
  });

  it("guards formula injection", () => {
    expect(escapeCsvCell("=HYPERLINK(...)")).toBe("'=HYPERLINK(...)");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("+62812", false)).toBe("+62812");
  });

  it("builds an Excel-friendly CSV with BOM and CRLF", () => {
    const csv = buildCsv(["full_name"], [["Budi"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toBe("\uFEFFfull_name\r\nBudi\r\n");
  });

  it("downloads a template with only the canonical headers", () => {
    const csv = participantTemplateCsv();
    expect(csv.replace("\uFEFF", "")).toBe(
      "external_ref,full_name,phone,email,category,note\r\n",
    );
  });
});
