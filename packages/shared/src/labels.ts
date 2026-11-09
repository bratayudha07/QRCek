import { z } from "zod";

/**
 * Label display configuration (Tahap 4).
 *
 * Which participant attributes appear on a printed label is **per event**: one
 * event prints class names, another prints an external reference. The catalog
 * below is deliberately limited to columns that already exist on `participants`
 * — no arbitrary participant schema, no template engine.
 *
 * `phone`/`email` are offered because they are already visible to every caller
 * that may print labels (`qr:print` = `event_admin`). They stay out of the
 * default set so a badge does not leak a phone number unless someone chose it.
 */

export const LABEL_FIELD_KEYS = [
  "fullName",
  "externalRef",
  "category",
  "phone",
  "email",
  "note",
] as const;

export type LabelFieldKey = (typeof LABEL_FIELD_KEYS)[number];

export interface LabelFieldMeta {
  key: LabelFieldKey;
  /** Indonesian label used in the admin UI. */
  label: string;
  /** Column length limit, used to keep a label cell from overflowing. */
  maxLength: number;
}

export const LABEL_FIELDS: readonly LabelFieldMeta[] = [
  { key: "fullName", label: "Nama", maxLength: 120 },
  { key: "externalRef", label: "Referensi", maxLength: 64 },
  { key: "category", label: "Kategori", maxLength: 60 },
  { key: "phone", label: "Telepon", maxLength: 32 },
  { key: "email", label: "Email", maxLength: 254 },
  { key: "note", label: "Catatan", maxLength: 500 },
];

/** Sensible default: the three fields almost every event has. */
export const DEFAULT_LABEL_FIELDS: readonly LabelFieldKey[] = [
  "fullName",
  "externalRef",
  "category",
];

/** Four text lines is what fits both print formats without shrinking the QR. */
export const MAX_LABEL_FIELDS = 4;

export function isLabelFieldKey(value: string): value is LabelFieldKey {
  return (LABEL_FIELD_KEYS as readonly string[]).includes(value);
}

export function labelFieldMeta(key: LabelFieldKey): LabelFieldMeta {
  const meta = LABEL_FIELDS.find((field) => field.key === key);
  // The union type makes this unreachable; the throw keeps it honest at runtime.
  if (!meta) throw new Error(`Unknown label field: ${key}`);
  return meta;
}

/**
 * Trims a value for a printed label. Newlines become spaces because a label
 * cell is a single block, and long values are hard-truncated with an ellipsis
 * instead of silently clipped by the printer.
 */
export function formatLabelValue(value: string | null | undefined, maxLength: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export type LabelPrintFormat = "a4" | "sticker";

/** A4: 3 columns × 8 rows per page (the agreed initial layout). */
export const A4_COLUMNS = 3;
export const A4_ROWS = 8;
export const A4_LABELS_PER_PAGE = A4_COLUMNS * A4_ROWS;

/** Individual sticker, in millimetres. */
export const STICKER_WIDTH_MM = 50;
export const STICKER_HEIGHT_MM = 30;

/**
 * Free-tier limits. The batch is 40, not 50: one label page costs roughly
 * `40 insert + 10 auth/read/audit` statements, and D1 free tier allows 50
 * statements per Worker invocation (see `QrLabelRequestSchema` and
 * `spike.qr-labels.measure.test.ts`). CPU was measured separately: 100
 * credentials cost ~12 ms p50, so 40 stays well inside the ~10 ms CPU budget.
 */
export const QR_LABEL_BATCH_MAX = 40;
export const QR_LABEL_BATCH_DEFAULT = 40;

const LabelFieldListSchema = z
  .array(z.enum(LABEL_FIELD_KEYS))
  .min(1)
  .max(MAX_LABEL_FIELDS)
  .refine((fields) => new Set(fields).size === fields.length, {
    message: "Field label tidak boleh duplikat",
  });

/**
 * Two ways to choose what to print:
 *   - no `participantIds`: every active participant, one cursor page at a time;
 *   - `participantIds`: an explicit selection (at most one batch), no cursor.
 *
 * `fields`/`showEventName` are optional so a client that only saved a config can
 * omit them and let the server apply the event's stored configuration.
 */
export const QrLabelRequestSchema = z
  .object({
    format: z.enum(["a4", "sticker"]).default("a4"),
    fields: LabelFieldListSchema.optional(),
    showEventName: z.boolean().optional(),
    participantIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(QR_LABEL_BATCH_MAX)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Peserta yang dipilih tidak boleh duplikat",
      })
      .optional(),
    limit: z.number().int().min(1).max(QR_LABEL_BATCH_MAX).default(QR_LABEL_BATCH_DEFAULT),
    cursor: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((value) => !(value.participantIds && value.cursor), {
    message: "Cursor tidak dipakai saat memilih peserta secara eksplisit",
    path: ["cursor"],
  });

export type QrLabelRequest = z.infer<typeof QrLabelRequestSchema>;
/** Client shape: defaults such as `limit` may be omitted. */
export type QrLabelRequestInput = z.input<typeof QrLabelRequestSchema>;

export const LabelConfigRequestSchema = z
  .object({
    fields: LabelFieldListSchema,
    showEventName: z.boolean().default(true),
  })
  .strict();

export type LabelConfigRequest = z.infer<typeof LabelConfigRequestSchema>;

export interface LabelConfigPayload {
  fields: LabelFieldKey[];
  showEventName: boolean;
}

export interface QrLabelItem {
  participantId: string;
  /**
   * Opaque scan payload (`absensi:v1:<token>`), exactly what Stage 5 will POST
   * to `/api/events/:id/scan`. Never the raw token, never a hash.
   */
  qr: string;
  /** Only non-empty values, keyed by field. Order comes from `fields`. */
  values: Partial<Record<LabelFieldKey, string>>;
}

export interface QrLabelPayload {
  event: { id: string; name: string };
  format: LabelPrintFormat;
  fields: LabelFieldKey[];
  showEventName: boolean;
  labels: QrLabelItem[];
  nextCursor: string | null;
}
