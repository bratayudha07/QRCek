import type { CategorySummary, ParticipantSummary } from "@absensi/shared";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { FormErrorSummary } from "@/components/form-error-summary";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { categorySelectOptions } from "@/lib/categories";
import {
  errorFor,
  mergeFieldErrors,
  summarizeFieldErrors,
  type FieldErrorMap,
} from "@/lib/form-errors";

/**
 * Create/edit form for one participant. Validation stays server-side.
 *
 * Categories come from the managed list, never from free text: a typed name
 * used to create a category silently on the server (Q2 delta).
 */

export interface ParticipantFormValues {
  externalRef: string;
  fullName: string;
  phone: string;
  email: string;
  categoryId: string;
  note: string;
}

export function ParticipantForm({
  mode,
  initial,
  categories,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: ParticipantSummary;
  categories: readonly CategorySummary[];
  submitting: boolean;
  error: string | null;
  /** Server-side `details.fieldErrors`, when the caller has them. */
  fieldErrors?: FieldErrorMap;
  onSubmit: (values: ParticipantFormValues) => void;
  onCancel?: () => void;
}) {
  const [externalRef, setExternalRef] = useState(initial?.externalRef ?? "");
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [localErrors, setLocalErrors] = useState<FieldErrorMap>({});

  // Active categories only, plus the participant's own archived one so an edit
  // never forces a move to another category.
  const categoryOptions = categorySelectOptions(categories, initial?.categoryId);

  const shownErrors = mergeFieldErrors(fieldErrors, localErrors);
  const summary = [...summarizeFieldErrors(fieldErrors), ...summarizeFieldErrors(localErrors)];
  if (error) summary.push(error);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next: FieldErrorMap = {};
    if (fullName.trim() === "") next.fullName = "Nama peserta wajib diisi";
    if (categoryId.trim() === "") next.categoryId = "Kategori wajib diisi";

    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;

    onSubmit({
      externalRef: externalRef.trim(),
      fullName: fullName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      categoryId: categoryId.trim(),
      note: note.trim(),
    });
  }

  return (
    <form className="space-y-4 rounded-lg border p-4" onSubmit={submit} noValidate>
      <FormErrorSummary errors={summary} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nama lengkap"
          htmlFor="participant-name"
          required
          error={errorFor(shownErrors, "fullName")}
        >
          <Input
            id="participant-name"
            value={fullName}
            onChange={(event) => {
              setFullName(event.target.value);
              if (localErrors.fullName) {
                setLocalErrors(({ fullName: _removed, ...rest }) => rest);
              }
            }}
            maxLength={120}
            required
          />
        </Field>

        <Field
          label="Nomor referensi"
          htmlFor="participant-ref"
          hint="Opsional. Kunci idempoten saat impor CSV."
          error={errorFor(shownErrors, "externalRef")}
        >
          <Input
            id="participant-ref"
            value={externalRef}
            onChange={(event) => setExternalRef(event.target.value)}
            maxLength={64}
            placeholder="Contoh: NIS-001"
          />
        </Field>

        <Field
          label="Nomor telepon"
          htmlFor="participant-phone"
          hint="08… otomatis menjadi +62…."
          error={errorFor(shownErrors, "phone")}
        >
          <Input
            id="participant-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={32}
            inputMode="tel"
          />
        </Field>

        <Field
          label="Email"
          htmlFor="participant-email"
          error={errorFor(shownErrors, "email")}
        >
          <Input
            id="participant-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
          />
        </Field>

        <Field
          label="Kategori"
          htmlFor="participant-category"
          hint={
            categoryOptions.length === 0
              ? "Belum ada kategori aktif. Buka “Kelola kategori” untuk membuat kategori baru."
              : undefined
          }
          required
          error={errorFor(shownErrors, "categoryId")}
        >
          <Select
            id="participant-category"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              if (localErrors.categoryId) {
                setLocalErrors(({ categoryId: _removed, ...rest }) => rest);
              }
            }}
            disabled={categoryOptions.length === 0}
            required
          >
            <option value="">Pilih kategori</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Catatan"
        htmlFor="participant-note"
        hint="Opsional, maksimal 500 karakter."
        error={errorFor(shownErrors, "note")}
      >
        <Textarea
          id="participant-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting || categoryOptions.length === 0}>
          {submitting && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {mode === "create" ? "Tambah peserta" : "Simpan perubahan"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Batal
          </Button>
        )}
      </div>
    </form>
  );
}
