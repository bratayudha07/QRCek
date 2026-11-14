import type { AttendanceRecord, AttendanceStatus, ParticipantSummary, StaffContext } from "@absensi/shared";
import { useEffect, useState, type FormEvent } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { createManualAttendance } from "@/lib/attendance";
import { manualEntryRequest, manualEntryStatuses } from "@/lib/manual-entry";
import { listParticipants } from "@/lib/participants";
import { staffContextLabel } from "@/lib/scanner";

const SEARCH_LIMIT = 20;
const NOTE_MAX_LENGTH = 500;

type SearchState = "loading" | "ready" | "error";

/**
 * Manual Entry dialog for `/staff/scan` (Q5 delta).
 *
 * The Aktivitas/Sesi come from the active scanner context and cannot be changed
 * here. Nothing is shown as recorded before the Worker answers `ok`; a rejected
 * request keeps the dialog open with the Worker's own message.
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
  onRecorded: (record: AttendanceRecord) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  // Bumped on every submit so retrying the same term still sends a request.
  const [searchSeq, setSearchSeq] = useState(0);
  const [searchState, setSearchState] = useState<SearchState>("loading");
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState<ParticipantSummary[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantSummary | null>(null);
  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Closing resets the form, so reopening starts clean and a stale applied
  // search term never triggers a request of its own.
  useEffect(() => {
    if (open) return;
    setSearchQuery("");
    setAppliedSearch("");
    setSelectedParticipant(null);
    setStatus("present");
    setNote("");
    setFormError(null);
    setSaving(false);
  }, [open]);

  // The applied term drives the request, so typing never fires a search per key.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setSearchState("loading");
    setSearchError("");

    listParticipants(context.themeId, {
      query: appliedSearch,
      status: "active",
      limit: SEARCH_LIMIT,
    })
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          setSearchState("error");
          setSearchError(body.error.message);
          return;
        }
        setResults(body.data.items);
        setSearchState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSearchState("error");
        setSearchError("Tidak bisa menghubungi server");
      });

    return () => {
      cancelled = true;
    };
  }, [open, context.themeId, appliedSearch, searchSeq]);

  function runSearch(term: string) {
    // A new result set invalidates the previous pick: the recorded participant
    // must always be one the operator can see in the list.
    setSelectedParticipant(null);
    setAppliedSearch(term);
    setSearchSeq((value) => value + 1);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runSearch(searchQuery.trim());
  }

  async function submitManualEntry() {
    if (!selectedParticipant) return;

    setSaving(true);
    setFormError(null);

    try {
      const body = await createManualAttendance(
        context.themeId,
        manualEntryRequest(context, selectedParticipant.id, status, note),
      );

      if (!body.ok) {
        setFormError(body.error.message);
        return;
      }

      onRecorded(body.data.attendance);
      onClose();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} ariaLabel="Input manual kehadiran">
      <DialogHeader>
        <DialogTitle>Input manual</DialogTitle>
        <DialogDescription>
          {context.themeName} · {staffContextLabel(context)}
        </DialogDescription>
      </DialogHeader>

      <form className="space-y-3" onSubmit={submitSearch}>
        <Field label="Cari peserta" htmlFor="manual-entry-search">
          <div className="flex gap-2">
            <Input
              id="manual-entry-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Nama, NIK, atau email"
              autoFocus
            />
            <Button type="submit" variant="outline" disabled={searchState === "loading"}>
              Cari
            </Button>
          </div>
        </Field>
      </form>

      {searchState === "loading" ? (
        <LoadingState label="Mencari peserta…" />
      ) : searchState === "error" ? (
        <ErrorState message={searchError} onRetry={() => runSearch(appliedSearch)} />
      ) : results.length === 0 ? (
        <EmptyState>Tidak ada peserta aktif yang cocok.</EmptyState>
      ) : (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
          {results.map((participant) => {
            const selected = selectedParticipant?.id === participant.id;

            return (
              <li key={participant.id}>
                <button
                  type="button"
                  onClick={() => setSelectedParticipant(participant)}
                  aria-pressed={selected}
                  className={`flex w-full items-center justify-between gap-3 p-3 text-left text-sm transition-colors ${
                    selected ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{participant.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {participant.externalRef || participant.category || "Tanpa kategori"}
                    </span>
                  </span>
                  {selected && <Badge variant="outline">Dipilih</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 space-y-3">
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

        <Field
          label="Catatan (opsional)"
          htmlFor="manual-entry-note"
          hint="Misalnya alasan pencatatan tanpa QR."
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

      {formError && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
        >
          {formError}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Batal
        </Button>
        <Button
          type="button"
          disabled={saving || selectedParticipant === null}
          onClick={() => void submitManualEntry()}
        >
          {saving ? "Menyimpan…" : "Simpan kehadiran"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
