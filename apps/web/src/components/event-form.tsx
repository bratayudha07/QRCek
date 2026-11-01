import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { EventSummary } from "@absensi/shared";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/format";

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
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: EventSummary;
  submitting: boolean;
  error: string | null;
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
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const trimmedName = name.trim();
    if (trimmedName === "") {
      setLocalError("Nama acara wajib diisi");
      return;
    }

    const startValue = fromDateTimeLocalValue(startsAt, zone);
    const endValue = fromDateTimeLocalValue(endsAt, zone);

    if (startsAt.trim() !== "" && startValue === null) {
      setLocalError("Waktu mulai tidak valid");
      return;
    }
    if (endsAt.trim() !== "" && endValue === null) {
      setLocalError("Waktu selesai tidak valid");
      return;
    }
    if (startValue !== null && endValue !== null && endValue < startValue) {
      setLocalError("Waktu selesai tidak boleh sebelum waktu mulai");
      return;
    }

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
    <form className="space-y-4 rounded-lg border p-4" onSubmit={submit}>
      <Field label="Nama acara" htmlFor="event-name" required>
        <Input
          id="event-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder="Contoh: Wisuda Santri 2026"
          required
        />
      </Field>

      <Field label="Deskripsi" htmlFor="event-description" hint="Opsional, maksimal 1.000 karakter.">
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
      >
        <Input
          id="event-timezone"
          value={zone}
          onChange={(event) => setZone(event.target.value)}
          list="event-timezone-options"
          maxLength={64}
          required
        />
        <datalist id="event-timezone-options">
          {COMMON_TIMEZONES.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mulai" htmlFor="event-starts-at">
          <Input
            id="event-starts-at"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </Field>

        <Field label="Selesai" htmlFor="event-ends-at">
          <Input
            id="event-ends-at"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 rounded border-border"
          checked={allowManual}
          onChange={(event) => setAllowManual(event.target.checked)}
        />
        <span>
          Izinkan pencatatan manual
          <span className="block text-xs text-muted-foreground">
            Untuk tahap pemindaian nanti. Bisa diubah kapan saja sebelum acara diarsipkan.
          </span>
        </span>
      </label>

      {(localError ?? error) && (
        <p role="alert" className="text-sm text-red-600">
          {localError ?? error}
        </p>
      )}

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
