import type { ParticipantSummary } from "@absensi/shared";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, Input, Textarea } from "@/components/ui/field";

/** Create/edit form for one participant. Validation stays server-side. */

export interface ParticipantFormValues {
  externalRef: string;
  fullName: string;
  phone: string;
  email: string;
  category: string;
  note: string;
}

export function ParticipantForm({
  mode,
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: ParticipantSummary;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: ParticipantFormValues) => void;
  onCancel?: () => void;
}) {
  const [externalRef, setExternalRef] = useState(initial?.externalRef ?? "");
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    if (fullName.trim() === "") {
      setLocalError("Nama peserta wajib diisi");
      return;
    }

    onSubmit({
      externalRef: externalRef.trim(),
      fullName: fullName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      category: category.trim(),
      note: note.trim(),
    });
  }

  return (
    <form className="space-y-4 rounded-lg border p-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nama lengkap"
          htmlFor="participant-name"
          required
        >
          <Input
            id="participant-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={120}
            required
          />
        </Field>

        <Field
          label="Nomor referensi"
          htmlFor="participant-ref"
          hint="Opsional. Kunci idempoten saat impor CSV."
        >
          <Input
            id="participant-ref"
            value={externalRef}
            onChange={(event) => setExternalRef(event.target.value)}
            maxLength={64}
            placeholder="Contoh: NIS-001"
          />
        </Field>

        <Field label="Nomor telepon" htmlFor="participant-phone" hint="08… otomatis menjadi +62….">
          <Input
            id="participant-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={32}
            inputMode="tel"
          />
        </Field>

        <Field label="Email" htmlFor="participant-email">
          <Input
            id="participant-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
          />
        </Field>

        <Field label="Kategori" htmlFor="participant-category" hint="Contoh: Kelas 5A, Wali murid.">
          <Input
            id="participant-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            maxLength={60}
          />
        </Field>
      </div>

      <Field label="Catatan" htmlFor="participant-note" hint="Opsional, maksimal 500 karakter.">
        <Textarea
          id="participant-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
        />
      </Field>

      {(localError ?? error) && (
        <Alert variant="destructive">
          <AlertDescription>{localError ?? error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting}>
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
