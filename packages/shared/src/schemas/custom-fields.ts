import { z } from "zod";

/**
 * Runtime schemas for per-Tema custom fields (DESAIN_API.md §5, ADR-0014).
 *
 * `key` is the immutable JSON key used in `participants.attributes_json`; the
 * human-facing name is `label`. The type is changed through its own endpoint
 * because it needs a compatibility check against stored values.
 */

export const CustomFieldIdSchema = z.string().min(1).max(64);

export const CustomFieldTypeSchema = z.enum([
  "text",
  "number",
  "email",
  "phone",
  "select",
  "multi_select",
  "date",
  "textarea",
  "checkbox",
]);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const CustomFieldScopeSchema = z.enum(["participant", "activity"]);
export type CustomFieldScope = z.infer<typeof CustomFieldScopeSchema>;

export const CustomFieldStatusSchema = z.enum(["active", "archived"]);
export type CustomFieldStatus = z.infer<typeof CustomFieldStatusSchema>;

export const CUSTOM_FIELD_ACTIVE_LIMIT = 50;
export const CUSTOM_FIELD_OPTION_LIMIT = 100;

const CustomFieldKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/, "key harus diawali huruf kecil dan hanya berisi a-z, 0-9, _")
  .max(40);
const CustomFieldLabelSchema = z.string().trim().min(1).max(80);
const CustomFieldDescriptionSchema = z.string().trim().max(300);
const SortOrderSchema = z.number().int().min(0).max(1_000_000);
const OptionSchema = z.string().trim().min(1).max(60);

const optionsSchema = z
  .array(OptionSchema)
  .max(1_000)
  .refine((values) => new Set(values).size === values.length, {
    message: "opsi tidak boleh duplikat",
  });

export const CustomFieldCreateRequestSchema = z
  .object({
    key: CustomFieldKeySchema,
    label: CustomFieldLabelSchema,
    description: CustomFieldDescriptionSchema.nullable().optional(),
    type: CustomFieldTypeSchema,
    required: z.boolean().default(false),
    options: optionsSchema.optional(),
    scope: CustomFieldScopeSchema.default("participant"),
    sortOrder: SortOrderSchema.default(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.type === "select" || value.type === "multi_select") && !value.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "opsi wajib diisi untuk tipe select/multi_select",
      });
    }
    if (!["select", "multi_select"].includes(value.type) && value.options !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "opsi hanya berlaku untuk tipe select/multi_select",
      });
    }
  });

export type CustomFieldCreateRequest = z.infer<typeof CustomFieldCreateRequestSchema>;

/** `key` and `type` are absent on purpose: neither may be patched directly. */
export const CustomFieldUpdateRequestSchema = z
  .object({
    label: CustomFieldLabelSchema.optional(),
    description: CustomFieldDescriptionSchema.nullable().optional(),
    required: z.boolean().optional(),
    options: optionsSchema.optional(),
    sortOrder: SortOrderSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada perubahan yang dikirim",
  });

export type CustomFieldUpdateRequest = z.infer<typeof CustomFieldUpdateRequestSchema>;

export const CustomFieldStatusRequestSchema = z
  .object({ status: CustomFieldStatusSchema })
  .strict();

export type CustomFieldStatusRequest = z.infer<typeof CustomFieldStatusRequestSchema>;

export const CustomFieldTypeRequestSchema = z
  .object({ type: CustomFieldTypeSchema, options: optionsSchema.optional() })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.type === "select" || value.type === "multi_select") && !value.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "opsi wajib diisi saat mengubah tipe ke select/multi_select",
      });
    }
  });

export type CustomFieldTypeRequest = z.infer<typeof CustomFieldTypeRequestSchema>;

export const CustomFieldListQuerySchema = z.object({
  scope: CustomFieldScopeSchema.optional(),
  status: z.enum(["active", "archived", "all"]).default("active"),
});

export type CustomFieldListQuery = z.infer<typeof CustomFieldListQuerySchema>;
