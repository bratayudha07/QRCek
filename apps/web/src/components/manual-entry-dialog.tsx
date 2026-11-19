import type { AttendanceStatus, ParticipantSummary, StaffContext } from "@absensi/shared";
import { useEffect, useState } from "react";

import { FormErrorSummary } from "@/components/form-error-summary";
import { ParticipantCombobox } from "@/components/participant-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { createManualAttendance } from "@/lib/attendance";
import {
  consumptionManualRequest,
  consumptionManualSuccessMessage,
  createManualConsumption,
} from "@/lib/consumption";
import {
  manualEntryRequest,
  manualEntryStatuses,
  manualEntrySuccessMessage,
} from "@/lib/manual-entry";
import { staffContextLabel } from "@/lib/scanner";

const NOTE_MAX_LENGTH = 500;

/**
 * Manual Entry dialog for `/staff/scan` (Q5 delta, Q7 consumption).
 *
 * The Aktivitas/Sesi come from the active scanner context and cannot be changed
 * here. Attendance posts a status; Consumption posts none and the Worker spends
 * one quota slot instead. Nothing is shown as recorded before the Worker answers
 * `ok`; a rejected request keeps the dialog open with the Worker's own message.
 */
export function ManualEntryDialog({
  context,
  open,
  onClose,
  onRecorded,
}: {
  context: StaffContext;
  open: boolean;
  onClose: () => void;
  /** Ready-to-display confirmation; the caller owns where it is shown. */
  onRecorded: (message: string) => void;
}) {
  const consumption = context.transactionType === "consumption";
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantSummary | null>(null);
  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Closing resets the form, so reopening starts clean.
  useEffect(() => {
    if (open) return;
    setSelectedParticipant(null);
    setStatus("present");
    setNote("");
    setFormError(null);
    setSelectionError(null);
    setSaving(false);
  }, [open]);

  async function submitManualEntry() {
    if (!selectedParticipant) {
      setSelectionError("Pilih peserta terlebih dahulu.");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      if (consumption) {
        const body = await createManualConsumption(
          context.themeId,
          consumptionManualRequest(context, selectedParticipant.id, note),
        );

        if (!body.ok) {
          setFormError(body.error.message);
          return;
        }

        onRecorded(
          consumptionManualSuccessMessage(
            selectedParticipant.fullName,
            body.data.transaction.slotNo,
          ),
        );
        onClose();
        return;
      }

      const body = await createManualAttendance(
        context.themeId,
        manualEntryRequest(context, selectedParticipant.id, status, note),
      );

      if (!body.ok) {
        setFormError(body.error.message);
        return;
      }

      onRecorded(manualEntrySuccessMessage(body.data.attendance));
      onClose();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={consumption ? "Input manual konsumsi" : "Input manual kehadiran"}
    >
      <DialogHeader>
        <DialogTitle>{consumption ? "Input manual konsumsi" : "Input manual"}</DialogTitle>
        <DialogDescription>
          {context.themeName} · {staffContextLabel(context)}
        </DialogDescription>
      </DialogHeader>

      <Field
        label="Peserta"
        htmlFor="manual-entry-participant"
        required
        error={selectionError ?? undefined}
      >
        <ParticipantCombobox
          id="manual-entry-participant"
          themeId={context.themeId}
          value={selectedParticipant}
          onChange={(participant) => {
            setSelectedParticipant(participant);
            setSelectionError(null);
          }}
          disabled={saving}
          autoFocus
        />
      </Field>

      <div className="mt-4 space-y-3">
        {!consumption && (
          <Field label="Status kehadiran" htmlFor="manual-entry-status">
            <Select
              id="manual-entry-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as AttendanceStatus)}
            >
              {manualEntryStatuses().map((option) => (
                <option key={option.status} value={option.status}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label="Catatan (opsional)"
          htmlFor="manual-entry-note"
          hint={
            consumption
              ? "Misalnya alasan pemberian tanpa QR."
              : "Misalnya alasan pencatatan tanpa QR."
          }
        >
          <Textarea
            id="manual-entry-note"
            className="min-h-20"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={NOTE_MAX_LENGTH}
          />
        </Field>
      </div>

      <FormErrorSummary
        errors={formError ? [formError] : []}
        title="Catatan manual belum tersimpan:"
      />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Batal
        </Button>
        <Button type="button" disabled={saving} onClick={() => void submitManualEntry()}>
          {saving ? "Menyimpan…" : consumption ? "Simpan konsumsi" : "Simpan kehadiran"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
