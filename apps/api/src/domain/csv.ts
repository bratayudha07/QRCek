/**
 * Minimal RFC 4180 CSV reader/writer.
 *
 * Pure: no I/O, no database, no clock. The Worker's import/export paths call
 * these functions, and the unit suite exercises the edge cases (quoted commas,
 * embedded newlines, escaped quotes, BOM, `;` delimiter, blank lines).
 *
 * A hand-written parser is deliberate. `csv-parse` would be another dependency
 * for ~120 lines of logic, and AGENTS.md requires a justification for every
 * package; there is none that beats "we need to own the error line numbers".
 */

export class CsvFormatError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvFormatError";
  }
}

export interface CsvRow {
  /** 1-based physical line where the record starts. Header is line 1. */
  line: number;
  values: string[];
}

export type CsvDelimiter = "," | ";";

/** Picks `;` only when the header line clearly uses more semicolons. */
export function detectDelimiter(text: string): CsvDelimiter {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i] as string;

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }

    if (!inQuotes) {
      if (char === ",") commas += 1;
      if (char === ";") semicolons += 1;
      if (char === "\n" || char === "\r") break;
    }

    i += 1;
  }

  return semicolons > commas ? ";" : ",";
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parses rows and returns every non-blank record, starting with the header.
 * Throws `CsvFormatError` for structural problems (unterminated quote).
 */
export function parseCsv(input: string, delimiter?: CsvDelimiter): CsvRow[] {
  const text = stripBom(input);
  const separator = delimiter ?? detectDelimiter(text);

  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const finishRecord = (): void => {
    fields.push(field);
    field = "";

    const blank = fields.every((value) => value.trim() === "");
    if (!blank) rows.push({ line: recordLine, values: fields });

    fields = [];
  };

  while (i < text.length) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }

        inQuotes = false;
        i += 1;
        continue;
      }

      if (char === "\r") {
        // Normalise CRLF inside quotes to LF; the newline is data, not a row boundary.
        if (text[i + 1] === "\n") i += 1;
        field += "\n";
        line += 1;
        i += 1;
        continue;
      }

      if (char === "\n") {
        field += "\n";
        line += 1;
        i += 1;
        continue;
      }

      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      if (field === "") {
        inQuotes = true;
        i += 1;
        continue;
      }

      // A quote in the middle of an unquoted field is data, not a delimiter.
      field += '"';
      i += 1;
      continue;
    }

    if (char === separator) {
      fields.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      line += 1;
      recordLine = line;
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvFormatError("Tanda kutip pada CSV tidak ditutup", recordLine);
  }

  // A file without a trailing newline still has one last record.
  if (field !== "" || fields.length > 0) finishRecord();

  return rows;
}

/** Escapes one CSV cell. Guards against spreadsheet formula injection. */
export function escapeCsvCell(value: string | number | null, guardFormula = true): string {
  let text = value === null ? "" : String(value);

  if (guardFormula && /^[=@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function buildCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string {
  const lines = [headers.map((header) => escapeCsvCell(header, false)).join(",")];

  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvCell(cell)).join(","));
  }

  // BOM keeps Excel from mangling UTF-8 names; CRLF is what Excel expects.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
