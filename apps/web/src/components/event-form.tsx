import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { EventSummary } from "@absensi/shared";

import { FormErrorSummary } from "@/components/form-error-summary";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Label, Textarea } from "@/components/ui/field";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/format";
import {
  errorFor,
  mergeFieldErrors,
  summarizeFieldErrors,
  type FieldErrorMap,
} from "@/lib/form-errors";

/**
 * Create/edit form for an event.
 *
 * Times are entered as wall-clock in the event's timezone and converted to UTC
 * epoch milliseconds before they leave the browser. The Worker only ever stores
 * UTC (AGENTS.md data integrity rules); the timezone is used again on display.
 */

export interface EventFormValues {
  name: string;
  description: string;
  timezone: string;
  startsAt: number | null;
  endsAt: number | null;
  allowManual: boolean;
}

const COMMON_TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
  "UTC",
] as const;

export function EventForm({
  mode,
  initial,
  submitting,
  error,
  fieldErrors,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: EventSummary;
  submitting: boolean;
  error: string | null;
  /** Server-side `details.fieldErrors`, when the caller has them. */
  fieldErrors?: FieldErrorMap;
  onSubmit: (values: EventFormValues) => void;
  onCancel?: () => void;
}) {
  const timezone = initial?.timezone ?? "Asia/Jakarta";

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [zone, setZone] = useState(timezone);
  const [startsAt, setStartsAt] = useState(toDateTimeLocalValue(initial?.startsAt ?? null, timezone));
  const [endsAt, setEndsAt] = useState(toDateTimeLocalValue(initial?.endsAt ?? null, timezone));
  const [allowManual, setAllowManual] = useState(initial?.allowManual ?? false);
  const [localErrors, setLocalErrors] = useState<FieldErrorMap>({});

  const shownErrors = mergeFieldErrors(fieldErrors, localErrors);
  const summary = [...summarizeFieldErrors(fieldErrors), ...summarizeFieldErrors(localErrors)];
  if (error) summary.push(error);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next: FieldErrorMap = {};

    const trimmedName = name.trim();
    if (trimmedName === "") next.name = "Nama acara wajib diisi";

    if (zone.trim() === "") next.timezone = "Zona waktu wajib diisi";

    const startValue = fromDateTimeLocalValue(startsAt, zone);
    const endValue = fromDateTimeLocalValue(endsAt, zone);

    if (startsAt.trim() !== "" && startValue === null) {
      next.startsAt = "Waktu mulai tidak valid";
    }
    if (endsAt.trim() !== "" && endValue === null) {
      next.endsAt = "Waktu selesai tidak valid";
    }
    if (startValue !== null && endValue !== null && endValue < startValue) {
      next.endsAt = "Waktu selesai tidak boleh sebelum waktu mulai";
    }

    setLocalErrors(next);
    if (Object.keys(next).length > 0) return;

    onSubmit({
      name: trimmedName,
      description: description.trim(),
      timezone: zone.trim(),
      startsAt: startValue,
      endsAt: endValue,
      allowManual,
    });
  }

  return (
    <form className="space-y-4 rounded-lg border p-4" onSubmit={submit} noValidate>
      <FormErrorSummary errors={summary} />

      <Field
        label="Nama acara"
        htmlFor="event-name"
        required
        error={errorFor(shownErrors, "name")}
      >
        <Input
          id="event-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (localErrors.name) setLocalErrors(({ name: _removed, ...rest }) => rest);
          }}
          maxLength={120}
          placeholder="Contoh: Wisuda Santri 2026"
          required
        />
      </Field>

      <Field
        label="Deskripsi"
        htmlFor="event-description"
        hint="Opsional, maksimal 1.000 karakter."
        error={errorFor(shownErrors, "description")}
      >
        <Textarea
          id="event-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={1_000}
          placeholder="Catatan singkat tentang acara"
        />
      </Field>

      <Field
        label="Zona waktu"
        htmlFor="event-timezone"
        hint="Dipakai untuk menampilkan jadwal dan menafsirkan waktu di bawah."
        error={errorFor(shownErrors, "timezone")}
      >
        <Input
          id="event-timezone"
          value={zone}
          onChange={(event) => setZone(event.target.value)}
          list="event-timezone-options"
          maxLength={64}
          required
        />
      </Field>
      <datalist id="event-timezone-options">
        {COMMON_TIMEZONES.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Mulai"
          htmlFor="event-starts-at"
          error={errorFor(shownErrors, "startsAt")}
        >
          <Input
            id="event-starts-at"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </Field>

        <Field
          label="Selesai"
          htmlFor="event-ends-at"
          error={errorFor(shownErrors, "endsAt")}
        >
          <Input
            id="event-ends-at"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </Field>
      </div>

      <Label className="flex items-start gap-2 text-sm font-normal">
        <Checkbox
          className="mt-0.5"
          checked={allowManual}
          onChange={(event) => setAllowManual(event.target.checked)}
        />
        <span>
          Izinkan pencatatan manual
          <span className="block text-xs text-muted-foreground">
            Untuk tahap pemindaian nanti. Bisa diubah kapan saja sebelum acara diarsipkan.
          </span>
        </span>
      </Label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {mode === "create" ? "Buat acara" : "Simpan perubahan"}
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
