import { IMPORT_MAX_ROWS, type ImportInvalidRow } from "@absensi/shared";

import { CsvFormatError, buildCsv, parseCsv } from "./csv";

/**
 * Participant CSV contract (DESAIN_API.md §5).
 *
 * Validation is pure and reports the physical line of every rejected record.
 * The API adds database state (which external_ref already exists) on top; this
 * module never touches D1.
 */

export const PARTICIPANT_CSV_HEADERS = [
  "external_ref",
  "full_name",
  "phone",
  "email",
  "category",
  "note",
] as const;

const ALLOWED_HEADERS = new Set<string>(PARTICIPANT_CSV_HEADERS);
const REQUIRED_HEADERS = ["full_name"] as const;

export interface ValidParticipantRow {
  line: number;
  externalRef: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  category: string | null;
  note: string | null;
}

export interface ParticipantCsvResult {
  total: number;
  rows: ValidParticipantRow[];
  invalid: ImportInvalidRow[];
}

export function participantTemplateCsv(): string {
  return buildCsv(PARTICIPANT_CSV_HEADERS, []);
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function optional(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PhoneResult {
  value: string | null;
  error?: string;
}

/** Indonesian numbers become `+62…`; already-international `+…` is preserved. */
export function normalizePhone(raw: string | undefined): PhoneResult {
  const input = (raw ?? "").trim();
  if (input === "") return { value: null };

  const compact = input.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) {
    return { value: null, error: "nomor telepon hanya boleh berisi angka dan +" };
  }

  const digits = compact.replace(/^\+/, "");
  let normalized: string;

  if (compact.startsWith("+")) {
    normalized = `+${digits}`;
  } else if (digits.startsWith("62")) {
    normalized = `+${digits}`;
  } else if (digits.startsWith("0")) {
    normalized = `+62${digits.slice(1)}`;
  } else {
    normalized = `+62${digits}`;
  }

  if (digits.length < 8 || digits.length > 15) {
    return { value: null, error: "nomor telepon harus 8–15 digit" };
  }

  return { value: normalized };
}

export function normalizeEmail(raw: string | undefined): { value: string | null; error?: string } {
  const input = (raw ?? "").trim().toLowerCase();
  if (input === "") return { value: null };

  if (input.length > 254 || !EMAIL_PATTERN.test(input)) {
    return { value: null, error: "format email tidak valid" };
  }

  return { value: input };
}

function headerIndex(header: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();

  for (const [index, raw] of header.entries()) {
    const name = raw.trim().toLowerCase();

    if (name === "") throw new CsvFormatError(`Header kolom ke-${index + 1} kosong`, 1);
    if (!ALLOWED_HEADERS.has(name)) {
      throw new CsvFormatError(
        `Kolom "${name}" tidak dikenal. Gunakan: ${PARTICIPANT_CSV_HEADERS.join(", ")}`,
        1,
      );
    }
    if (map.has(name)) throw new CsvFormatError(`Header "${name}" duplikat`, 1);

    map.set(name, index);
  }

  for (const required of REQUIRED_HEADERS) {
    if (!map.has(required)) {
      throw new CsvFormatError(`Header wajib "${required}" tidak ditemukan`, 1);
    }
  }

  return map;
}

function rowError(errors: string[]): string {
  return errors.join("; ");
}

/**
 * Validates every row. A row that fails any rule is reported and skipped; valid
 * rows are returned so a partial import can proceed (DESAIN_API.md §5).
 */
export function parseParticipantCsv(text: string): ParticipantCsvResult {
  const parsed = parseCsv(text);
  if (parsed.length === 0) throw new CsvFormatError("File CSV kosong", 1);

  const header = parsed[0] as { line: number; values: string[] };
  const indexes = headerIndex(header.values);
  const dataRows = parsed.slice(1);

  if (dataRows.length > IMPORT_MAX_ROWS) {
    throw new CsvFormatError(
      `File berisi ${dataRows.length} baris; batas per import adalah ${IMPORT_MAX_ROWS} baris`,
      header.line + 1,
    );
  }

  const rows: ValidParticipantRow[] = [];
  const invalid: ImportInvalidRow[] = [];
  const seenRefs = new Set<string>();
  const seenIdentities = new Set<string>();

  for (const row of dataRows) {
    const errors: string[] = [];
    const cell = (name: string): string => {
      const index = indexes.get(name);
      return index === undefined ? "" : (row.values[index] ?? "");
    };

    if (row.values.length > header.values.length) {
      invalid.push({
        line: row.line,
        reason: `jumlah kolom (${row.values.length}) melebihi header (${header.values.length})`,
      });
      continue;
    }

    const fullName = normalizeText(cell("full_name"));
    if (fullName === "") {
      errors.push("full_name wajib diisi");
    } else if (fullName.length > 120) {
      errors.push("full_name maksimal 120 karakter");
    }

    const externalRef = optional(cell("external_ref"));
    if (externalRef !== null && externalRef.length > 64) {
      errors.push("external_ref maksimal 64 karakter");
    }

    const phone = normalizePhone(cell("phone"));
    if (phone.error) errors.push(phone.error);

    const email = normalizeEmail(cell("email"));
    if (email.error) errors.push(email.error);

    const category = optional(cell("category"));
    if (category !== null && category.length > 60) {
      errors.push("category maksimal 60 karakter");
    }

    const note = optional(cell("note"));
    if (note !== null && note.length > 500) {
      errors.push("note maksimal 500 karakter");
    }

    if (errors.length > 0) {
      invalid.push({ line: row.line, reason: rowError(errors) });
      continue;
    }

    const identityContact = phone.value ?? email.value;
    const identity =
      identityContact === null ? null : `${fullName.toLowerCase()}|${identityContact}`;

    if (externalRef !== null && seenRefs.has(externalRef)) {
      invalid.push({ line: row.line, reason: "external_ref duplikat di dalam file" });
      continue;
    }

    if (identity !== null && seenIdentities.has(identity)) {
      invalid.push({
        line: row.line,
        reason: "peserta serupa duplikat di dalam file (nama + kontak)",
      });
      continue;
    }

    if (externalRef !== null) seenRefs.add(externalRef);
    if (identity !== null) seenIdentities.add(identity);

    rows.push({
      line: row.line,
      externalRef,
      fullName,
      phone: phone.value,
      email: email.value,
      category,
      note,
    });
  }

  return { total: dataRows.length, rows, invalid };
}
