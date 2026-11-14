import type { CategorySummary, EventSummary, ParticipantSummary } from "@absensi/shared";
import { ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import {
  ParticipantForm,
  type ParticipantFormValues,
} from "@/components/participant-form";
import { ParticipantStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { listCategories } from "@/lib/categories";
import { getEvent } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { PARTICIPANT_STATUS_LABEL } from "@/lib/labels";
import {
  deactivateParticipant,
  getParticipant,
  updateParticipant,
} from "@/lib/participants";
import { navigate, participantsPath } from "@/lib/router";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; participant: ParticipantSummary; event: EventSummary }
  | { status: "error"; message: string };

export function ParticipantDetailPage({
  eventId,
  participantId,
}: {
  eventId: string;
  participantId: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [showEdit, setShowEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoryKey, setCategoryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setCategoriesError(null);

    // The form needs every category, archived ones included: a participant may
    // still point at an archived category and editing must not force a move.
    listCategories(eventId, "all")
      .then((body) => {
        if (cancelled) return;

        if (!body.ok) {
          setCategoriesError(body.error.message);
          return;
        }

        setCategories(body.data.categories);
      })
      .catch(() => {
        if (!cancelled) setCategoriesError("Tidak bisa menghubungi server");
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, categoryKey]);

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });

    Promise.all([getParticipant(eventId, participantId), getEvent(eventId)])
      .then(([participantBody, eventBody]) => {
        if (cancelled) return;

        if (participantBody.ok && eventBody.ok) {
          setState({
            status: "ready",
            participant: participantBody.data.participant,
            event: eventBody.data.event,
          });
          return;
        }

        const message = !participantBody.ok
          ? participantBody.error.message
          : !eventBody.ok
            ? eventBody.error.message
            : "Gagal memuat peserta";

        setState({ status: "error", message });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, participantId, reloadKey]);

  if (state.status === "loading") {
    return (
      <AppShell
        title="Peserta"
        backTo={participantsPath(eventId)}
      >
        <LoadingState label="Memuat peserta…" />
      </AppShell>
    );
  }

  if (state.status === "error") {
    return (
      <AppShell
        title="Peserta"
        backTo={participantsPath(eventId)}
      >
        <ErrorState message={state.message} onRetry={() => setReloadKey((key) => key + 1)} />
      </AppShell>
    );
  }

  const { participant, event } = state;
  const canWrite = event.accessRole !== "officer" && event.status !== "archived";

  async function submitEdit(values: ParticipantFormValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const body = await updateParticipant(eventId, participantId, {
        externalRef: values.externalRef === "" ? null : values.externalRef,
        fullName: values.fullName,
        phone: values.phone === "" ? null : values.phone,
        email: values.email === "" ? null : values.email,
        categoryId: values.categoryId,
        note: values.note === "" ? null : values.note,
      });

      if (body.ok) {
        setState({ status: "ready", participant: body.data.participant, event });
        setShowEdit(false);
        setActionNotice("Data peserta diperbarui.");
        return;
      }

      setFormError(body.error.message);
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(status: "active" | "inactive") {
    if (status === "inactive") {
      const confirmed = window.confirm(
        "Nonaktifkan peserta ini? Data tetap tersimpan dan bisa diaktifkan kembali.",
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setActionError(null);
    setActionNotice(null);

    try {
      if (status === "inactive") {
        const body = await deactivateParticipant(eventId, participantId);

        if (!body.ok) {
          setActionError(body.error.message);
          return;
        }

        setState({
          status: "ready",
          participant: { ...participant, status: "inactive" },
          event,
        });
        setActionNotice("Peserta dinonaktifkan. Datanya tetap tersimpan.");
        return;
      }

      const body = await updateParticipant(eventId, participantId, { status: "active" });

      if (body.ok) {
        setState({ status: "ready", participant: body.data.participant, event });
        setActionNotice("Peserta diaktifkan kembali.");
      } else {
        setActionError(body.error.message);
      }
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title={participant.fullName}
      subtitle={event.name}
      backTo={participantsPath(eventId)}
      actions={<ParticipantStatusBadge status={participant.status} />}
    >
      {actionError && <ErrorState message={actionError} />}
      {actionNotice && <Notice tone="success">{actionNotice}</Notice>}

      {!canWrite && event.status === "archived" && (
        <Notice tone="warning">
          Acara sudah diarsipkan. Data peserta hanya dapat dibaca.
        </Notice>
      )}

      {!canWrite && event.status !== "archived" && (
        <Notice>Anda adalah petugas pada acara ini. Data hanya dapat dilihat.</Notice>
      )}

      {showEdit && canWrite ? (
        <>
          {categoriesError && (
            <ErrorState
              message={categoriesError}
              onRetry={() => setCategoryKey((key) => key + 1)}
            />
          )}
          <ParticipantForm
            mode="edit"
            initial={participant}
            categories={categories}
            submitting={submitting}
            error={formError}
            onSubmit={submitEdit}
            onCancel={() => {
              setShowEdit(false);
              setFormError(null);
            }}
          />
        </>
      ) : (
        <section className="rounded-lg border p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Nomor referensi</dt>
              <dd>{participant.externalRef ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Kategori</dt>
              <dd>{participant.category ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Telepon</dt>
              <dd>{participant.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="break-all">{participant.email ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Catatan</dt>
              <dd className="whitespace-pre-wrap">{participant.note ?? "—"}</dd>
            </div>
          </dl>

          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            Ditambahkan {formatDateTime(participant.createdAt, event.timezone)} · diperbarui{" "}
            {formatDateTime(participant.updatedAt, event.timezone)} · status{" "}
            {PARTICIPANT_STATUS_LABEL[participant.status]}
          </p>
        </section>
      )}

      {canWrite && !showEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowEdit(true)}>
            <Pencil aria-hidden="true" className="size-4" />
            Ubah data
          </Button>

          {participant.status === "active" ? (
            <Button
              variant="outline"
              className="text-red-600"
              onClick={() => setStatus("inactive")}
              disabled={busy}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Nonaktifkan
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setStatus("active")} disabled={busy}>
              <ArchiveRestore aria-hidden="true" className="size-4" />
              Aktifkan kembali
            </Button>
          )}
        </div>
      )}

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => navigate(participantsPath(eventId))}>
          Kembali ke daftar peserta
        </Button>
      </div>
    </AppShell>
  );
}
