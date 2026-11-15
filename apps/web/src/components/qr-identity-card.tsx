import type { QrIdentityMetadata, QrRotatePayload } from "@absensi/shared";
import { QrCode as QrCodeIcon, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { QrCode } from "@/components/qr-code";
import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { formatDateTime } from "@/lib/format";
import {
  getQrIdentity,
  nextRotationRequest,
  rotateQrIdentity,
  rotationReasonError,
  rotationSummary,
} from "@/lib/qr-identities";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; identity: QrIdentityMetadata | null }
  | { status: "error"; message: string };

/**
 * "Kartu QR" section for the participant detail page (Q4, ADR-0017).
 *
 * The parent only mounts this when `canRotateQr` is true, because the metadata
 * route requires `qr:print`. The Worker remains authoritative for the rotation;
 * nothing is shown as rotated before it answers `ok`, and the new payload lives
 * only in `issued` — it is cleared as soon as the panel closes.
 */
export function QrIdentityCard({
  eventId,
  participantId,
  timeZone,
}: {
  eventId: string;
  participantId: string;
  timeZone: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<QrRotatePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    getQrIdentity(eventId, participantId)
      .then((body) => {
        if (cancelled) return;

        if (!body.ok) {
          setState({ status: "error", message: body.error.message });
          return;
        }

        setState({ status: "ready", identity: body.data.identity });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, participantId, reloadKey]);

  const identity = state.status === "ready" ? state.identity : null;

  function openDialog() {
    setReason("");
    setFormError(null);
    setConflictMessage(null);
    setIssued(null);
    setDialogOpen(true);
  }

  /** Closing the panel drops the one-shot QR payload; it is never persisted. */
  function closeDialog() {
    setDialogOpen(false);
    setReason("");
    setFormError(null);
    setConflictMessage(null);
    setIssued(null);
  }

  function reloadMetadata() {
    closeDialog();
    setReloadKey((key) => key + 1);
  }

  async function submitRotation(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();

    const current = state.status === "ready" ? state.identity : null;
    if (current === null || submitting) return;

    const reasonError = rotationReasonError(reason);
    if (reasonError !== null) {
      setFormError(reasonError);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setConflictMessage(null);

    try {
      const body = await rotateQrIdentity(
        eventId,
        participantId,
        nextRotationRequest(current, reason),
      );

      if (!body.ok) {
        // 409 means another rotation landed first; the Worker message is shown
        // and the admin reloads instead of retrying with a stale count.
        if (body.error.code === "CONFLICT") {
          setConflictMessage(body.error.message);
        } else {
          setFormError(body.error.message);
        }
        return;
      }

      const payload = body.data;

      // Only metadata stays in the load state; `qr` is confined to `issued`.
      setState({
        status: "ready",
        identity: {
          participantId: payload.participantId,
          issuedAt: payload.issuedAt,
          rotatedAt: payload.rotatedAt,
          rotationCount: payload.rotationCount,
          keyVersion: payload.keyVersion,
        },
      });
      setIssued(payload);
      setReason("");
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <QrCodeIcon aria-hidden="true" className="size-4" />
            Kartu QR
          </h2>
          <p className="text-sm text-muted-foreground">
            Rotasi menerbitkan QR baru untuk peserta ini. Kartu lama langsung tidak berlaku.
          </p>
        </div>
        {state.status === "ready" && (
          <Badge variant={identity === null ? "muted" : "outline"}>
            {identity === null ? "Belum ada QR" : `Versi kunci ${identity.keyVersion}`}
          </Badge>
        )}
      </div>

      {state.status === "loading" ? (
        <LoadingState label="Memuat metadata QR…" />
      ) : state.status === "error" ? (
        <ErrorState message={state.message} onRetry={reloadMetadata} />
      ) : (
        <>
          <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
            <p className="text-sm">{rotationSummary(identity, timeZone)}</p>
            {identity === null && (
              <p className="text-xs text-muted-foreground">
                QR peserta diterbitkan saat kartu dicetak. Setelah itu rotasi bisa dilakukan dari
                halaman ini.
              </p>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={identity === null}
            onClick={openDialog}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Rotasi QR
          </Button>
        </>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        ariaLabel="Rotasi QR peserta"
        // Dismissal is blocked while the rotation is in flight: the Worker may
        // already have revoked the old card, and the one-shot payload must not
        // arrive after the panel was closed.
        dismissible={!submitting}
      >
        <DialogHeader>
          <DialogTitle>Rotasi QR peserta</DialogTitle>
          <DialogDescription>
            Rotasi wajib beralasan dan tercatat di audit. Kartu QR lama tidak bisa dipakai lagi
            setelah rotasi berhasil.
          </DialogDescription>
        </DialogHeader>

        {issued !== null ? (
          <div className="space-y-3">
            <Notice tone="warning">
              Kartu lama langsung tidak berlaku. Cetak atau bagikan QR baru ini sekarang — QR hanya
              ditampilkan sekali dan tidak bisa dibuka lagi setelah panel ditutup.
            </Notice>

            <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-3">
              <QrCode value={issued.qr} sizeMm={45} label="QR peserta hasil rotasi" />
              <span className="text-xs text-muted-foreground">
                Rotasi ke-{issued.rotationCount} · {formatDateTime(issued.rotatedAt, timeZone)}
              </span>
            </div>

            <DialogFooter>
              <Button type="button" onClick={closeDialog}>
                Tutup
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submitRotation}>
            <Field
              label="Alasan rotasi"
              htmlFor="qr-rotation-reason"
              required
              hint="3–500 karakter. Contoh: kartu hilang atau QR rusak."
            >
              <Textarea
                id="qr-rotation-reason"
                value={reason}
                rows={3}
                autoFocus
                disabled={submitting}
                onChange={(changeEvent) => {
                  setReason(changeEvent.target.value);
                  setFormError(null);
                }}
              />
            </Field>

            {formError !== null && (
              <p
                role="alert"
                className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
              >
                {formError}
              </p>
            )}

            {conflictMessage !== null && (
              <div className="space-y-2">
                <p
                  role="alert"
                  className="rounded-md border border-amber-600/30 bg-amber-600/5 p-2 text-sm text-amber-700"
                >
                  {conflictMessage}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={reloadMetadata}>
                  <RotateCcw aria-hidden="true" className="size-4" />
                  Muat ulang metadata
                </Button>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={submitting}
              >
                Batal
              </Button>
              {conflictMessage === null && (
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Memproses…" : "Rotasi QR"}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </Dialog>
    </section>
  );
}
