import type { Activity, EventAccessRole, TransactionRecord } from "@absensi/shared";
import { useEffect, useState, type FormEvent } from "react";

import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTransactions, reverseTransaction } from "@/lib/attendance";
import {
  canReverseConsumption,
  consumptionReversalNotice,
  consumptionSourceLabel,
} from "@/lib/consumption";
import { listParticipants } from "@/lib/participants";

const PAGE_LIMIT = 100;
const NAME_PAGE_LIMIT = 100;
/** Bounds the name lookup so a huge Tema cannot turn one dialog into many requests. */
const NAME_PAGE_MAX = 10;

type LoadState = "loading" | "ready" | "error";

async function loadParticipantNames(eventId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let cursor: string | null = null;

  for (let page = 0; page < NAME_PAGE_MAX; page += 1) {
    const body = await listParticipants(eventId, {
      status: "all",
      limit: NAME_PAGE_LIMIT,
      ...(cursor !== null ? { cursor } : {}),
    });
    if (!body.ok) break;

    for (const participant of body.data.items) {
      names.set(participant.id, participant.fullName);
    }

    cursor = body.data.nextCursor;
    if (cursor === null) break;
  }

  return names;
}

/**
 * Effective Consumption transactions for one Aktivitas (Q7 gate).
 *
 * The list is read-only except for Reversal, which the Worker restricts to the
 * Tema's Admin Acara. A reversed row disappears from this view because it is no
 * longer effective; the audit trail and the original row stay untouched.
 */
export function ConsumptionTransactionsDialog({
  eventId,
  activity,
  accessRole,
  open,
  onClose,
}: {
  eventId: string;
  activity: Pick<Activity, "id" | "name">;
  accessRole: EventAccessRole;
  open: boolean;
  onClose: () => void;
}) {
  const canReverse = canReverseConsumption(accessRole);
  const reversalNotice = consumptionReversalNotice(accessRole);

  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<TransactionRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selected, setSelected] = useState<TransactionRecord | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reopening starts clean: no stale success message or half-filled reason.
  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setActionError(null);
    setSelected(null);
    setReason("");
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setState("loading");
    setError("");

    Promise.all([
      listTransactions(eventId, {
        activityId: activity.id,
        type: "consumption",
        effective: "true",
        limit: PAGE_LIMIT,
      }),
      loadParticipantNames(eventId),
    ])
      .then(([transactionBody, nameMap]) => {
        if (cancelled) return;
        if (!transactionBody.ok) {
          setState("error");
          setError(transactionBody.error.message);
          return;
        }
        setRows(transactionBody.data.items);
        setCursor(transactionBody.data.nextCursor);
        setNames(nameMap);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
        setError("Tidak bisa menghubungi server");
      });

    return () => {
      cancelled = true;
    };
  }, [open, eventId, activity.id, reloadKey]);

  async function loadMore() {
    if (cursor === null) return;

    setLoadingMore(true);
    try {
      const body = await listTransactions(eventId, {
        activityId: activity.id,
        type: "consumption",
        effective: "true",
        limit: PAGE_LIMIT,
        cursor,
      });
      if (!body.ok) {
        setError(body.error.message);
        return;
      }
      setRows((current) => [...current, ...body.data.items]);
      setCursor(body.data.nextCursor);
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setLoadingMore(false);
    }
  }

  async function submitReversal(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (selected === null) return;

    setSaving(true);
    setActionError(null);
    try {
      const body = await reverseTransaction(eventId, selected.id, {
        reason: reason.trim(),
        expectedUpdatedAt: selected.updatedAt,
      });
      if (!body.ok) {
        setActionError(body.error.message);
        return;
      }
      setSelected(null);
      setReason("");
      setNotice("Transaksi dibatalkan. Kuota peserta kembali dan riwayat tetap tersimpan.");
      setReloadKey((value) => value + 1);
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setSaving(false);
    }
  }

  const participantName = (participantId: string) =>
    names.get(participantId) ?? "Peserta tidak dikenal";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={`Transaksi konsumsi ${activity.name}`}
      className="max-w-3xl"
      dismissible={!saving}
    >
      {selected !== null ? (
        <form className="space-y-4" onSubmit={(event) => void submitReversal(event)}>
          <DialogHeader>
            <DialogTitle>Batalkan transaksi konsumsi</DialogTitle>
            <DialogDescription>
              {participantName(selected.participantId)} · porsi {selected.slotNo ?? "—"} ·{" "}
              {new Date(selected.occurredAt).toLocaleString("id-ID")}
            </DialogDescription>
          </DialogHeader>

          <Notice tone="warning">
            Transaksi asli tidak dihapus. Ia ditandai dibatalkan, tidak lagi dihitung sebagai
            pemakaian, dan tetap terlihat di audit.
          </Notice>

          {actionError && (
            <p
              role="alert"
              className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
            >
              {actionError}
            </p>
          )}

          <Field label="Alasan (min. 3 karakter)" htmlFor="reversal-reason">
            <Textarea
              id="reversal-reason"
              className="min-h-24"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setSelected(null);
                setReason("");
                setActionError(null);
              }}
            >
              Kembali
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? "Membatalkan…" : "Batalkan transaksi"}
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <div className="space-y-4">
          <DialogHeader>
            <DialogTitle>Transaksi konsumsi · {activity.name}</DialogTitle>
            <DialogDescription>
              Hanya transaksi efektif. Pembatalan tidak menghapus baris asli: kuota peserta kembali
              dan jejaknya tercatat di audit.
            </DialogDescription>
          </DialogHeader>

          {reversalNotice && <Notice>{reversalNotice}</Notice>}

          {notice && <Notice tone="success">{notice}</Notice>}
          {actionError && (
            <p
              role="alert"
              className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
            >
              {actionError}
            </p>
          )}

          {state === "loading" && <LoadingState label="Memuat transaksi konsumsi…" />}
          {state === "error" && (
            <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} />
          )}
          {state === "ready" && rows.length === 0 && (
            <EmptyState>Belum ada transaksi konsumsi efektif untuk Aktivitas ini.</EmptyState>
          )}

          {state === "ready" && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Peserta</TableHead>
                  <TableHead>Porsi</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Sumber</TableHead>
                  {canReverse && <TableHead className="text-right">Aksi</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {participantName(row.participantId)}
                    </TableCell>
                    <TableCell>{row.slotNo ?? "—"}</TableCell>
                    <TableCell>{new Date(row.occurredAt).toLocaleString("id-ID")}</TableCell>
                    <TableCell>{consumptionSourceLabel(row.source)}</TableCell>
                    {canReverse && (
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActionError(null);
                            setSelected(row);
                          }}
                        >
                          Batalkan
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {error && state === "ready" && (
            <p
              role="alert"
              className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <DialogFooter className="justify-between">
            {cursor !== null && state === "ready" ? (
              <Button
                type="button"
                variant="outline"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Memuat…" : "Muat lagi"}
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Tutup
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}
