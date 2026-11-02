import type { EventSummary, EventSummaryPayload } from "@absensi/shared";
import { allowedEventTransitions } from "@absensi/shared";
import { Archive, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { EventForm, type EventFormValues } from "@/components/event-form";
import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import {
  changeEventStatus,
  deleteEvent,
  getEvent,
  getEventSummary,
  updateEvent,
} from "@/lib/events";
import { formatCount, formatDateTime } from "@/lib/format";
import {
  EVENT_STATUS_DESCRIPTION,
  EVENT_STATUS_LABEL,
  EVENT_TRANSITION_LABEL,
} from "@/lib/labels";
import { navigate, paths } from "@/lib/router";
import { useSession } from "@/lib/session";

type PageState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

/** `/admin/events/:id/overview` — event details, lifecycle, and participant totals. */
export function EventOverviewPage({ eventId }: { eventId: string }) {
  const session = useSession();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [summary, setSummary] = useState<EventSummaryPayload | null>(null);
  const [pageState, setPageState] = useState<PageState>({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);

  const [showEdit, setShowEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setPageState({ status: "loading" });

    Promise.all([getEvent(eventId), getEventSummary(eventId)])
      .then(([eventBody, summaryBody]) => {
        if (cancelled) return;

        if (eventBody.ok && summaryBody.ok) {
          setEvent(eventBody.data.event);
          setSummary(summaryBody.data);
          setPageState({ status: "ready" });
          return;
        }

        const message = !eventBody.ok
          ? eventBody.error.message
          : !summaryBody.ok
            ? summaryBody.error.message
            : "Gagal memuat acara";

        setPageState({ status: "error", message });
      })
      .catch(() => {
        if (!cancelled) setPageState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, refreshKey]);

  async function submitEdit(values: EventFormValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const body = await updateEvent(eventId, {
        name: values.name,
        description: values.description === "" ? null : values.description,
        timezone: values.timezone,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        allowManual: values.allowManual,
      });

      if (body.ok) {
        setEvent(body.data.event);
        setShowEdit(false);
        setActionNotice("Detail acara diperbarui.");
        return;
      }

      setFormError(body.error.message);
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(target: EventSummary["status"]) {
    setStatusBusy(true);
    setActionError(null);
    setActionNotice(null);

    try {
      const body = await changeEventStatus(eventId, target);

      if (body.ok) {
        setEvent(body.data.event);
        setActionNotice(`Status acara kini ${EVENT_STATUS_LABEL[target]}.`);
      } else {
        setActionError(body.error.message);
      }
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setStatusBusy(false);
    }
  }

  async function removeEvent() {
    const confirmed = window.confirm(
      "Hapus acara ini? Hanya draf tanpa peserta yang dapat dihapus permanen.",
    );
    if (!confirmed) return;

    setStatusBusy(true);
    setActionError(null);

    try {
      const body = await deleteEvent(eventId);

      if (body.ok) {
        navigate(paths.events);
        return;
      }

      setActionError(body.error.message);
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setStatusBusy(false);
    }
  }

  if (pageState.status === "loading") {
    return (
      <AppShell title="Ringkasan">
        <LoadingState label="Memuat acara…" />
      </AppShell>
    );
  }

  if (pageState.status === "error" || event === null) {
    return (
      <AppShell title="Ringkasan">
        <ErrorState
          message={pageState.status === "error" ? pageState.message : "Acara tidak ditemukan"}
          onRetry={() => setRefreshKey((key) => key + 1)}
        />
      </AppShell>
    );
  }

  const canWrite = event.accessRole !== "officer";
  const isSuperadmin = session.status === "authenticated" && session.user.role === "superadmin";
  const transitions = allowedEventTransitions(event.status);
  const isArchived = event.status === "archived";

  return (
    <AppShell title="Ringkasan">
      {actionError && <ErrorState message={actionError} />}
      {actionNotice && <Notice tone="success">{actionNotice}</Notice>}

      {isArchived && (
        <Notice tone="warning">
          <Archive aria-hidden="true" className="mr-1 inline size-4 align-[-2px]" />
          Acara sudah diarsipkan dan bersifat final. Semua data hanya dapat dibaca.
        </Notice>
      )}

      {!canWrite && (
        <Notice>Anda adalah petugas pada acara ini. Data hanya dapat dilihat.</Notice>
      )}

      {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}

      <section className="grid grid-cols-3 gap-2" aria-label="Ringkasan peserta">
        {[
          { label: "Total", value: summary?.participantCount ?? 0 },
          { label: "Aktif", value: summary?.activeParticipantCount ?? 0 },
          { label: "Nonaktif", value: summary?.inactiveParticipantCount ?? 0 },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border p-3 text-center">
            <p className="text-xl font-semibold tabular-nums">{formatCount(stat.value)}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Detail acara</h2>
            <p className="text-xs text-muted-foreground">
              Zona waktu {event.timezone} · dibuat {formatDateTime(event.createdAt, event.timezone)}
            </p>
          </div>

          {canWrite && !isArchived && !showEdit && (
            <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
              <Pencil aria-hidden="true" className="size-4" />
              Ubah
            </Button>
          )}
        </div>

        {showEdit && canWrite ? (
          <div className="mt-3">
            <EventForm
              mode="edit"
              initial={event}
              submitting={submitting}
              error={formError}
              onSubmit={submitEdit}
              onCancel={() => {
                setShowEdit(false);
                setFormError(null);
              }}
            />
          </div>
        ) : (
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Mulai</dt>
              <dd>{formatDateTime(event.startsAt, event.timezone)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Selesai</dt>
              <dd>{formatDateTime(event.endsAt, event.timezone)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Pencatatan manual</dt>
              <dd>{event.allowManual ? "Diizinkan" : "Tidak diizinkan"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Slug</dt>
              <dd className="truncate font-mono text-xs">{event.slug}</dd>
            </div>
          </dl>
        )}
      </section>

      {canWrite && (
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Status acara</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {EVENT_STATUS_DESCRIPTION[event.status]}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {transitions.map((target) => (
              <Button
                key={target}
                size="sm"
                variant={target === "archived" ? "outline" : "default"}
                disabled={statusBusy}
                onClick={() => changeStatus(target)}
              >
                {target === "archived" && <Archive aria-hidden="true" className="size-4" />}
                {EVENT_TRANSITION_LABEL[target]}
              </Button>
            ))}

            {isSuperadmin && event.status === "draft" && summary?.participantCount === 0 && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-600"
                disabled={statusBusy}
                onClick={removeEvent}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                Hapus draf
              </Button>
            )}
          </div>

          {isSuperadmin && event.status === "draft" && (summary?.participantCount ?? 0) > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Draf yang sudah punya peserta tidak dapat dihapus. Gunakan arsip.
            </p>
          )}
        </section>
      )}
    </AppShell>
  );
}
