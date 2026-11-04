import type { EventAccessRole, EventSummary } from "@absensi/shared";
import { CalendarDays, ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { EventForm, type EventFormValues } from "@/components/event-form";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { EventStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { createEvent, listEvents } from "@/lib/events";
import { formatCount, formatSchedule } from "@/lib/format";
import { eventOverviewPath, navigate } from "@/lib/router";
import { useSession } from "@/lib/session";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; events: EventSummary[] }
  | { status: "error"; message: string };

const ACCESS_LABEL: Record<EventAccessRole, string> = {
  superadmin: "Superadmin",
  event_admin: "Admin acara",
  officer: "Petugas",
};

export function EventsPage() {
  const session = useSession();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });
    listEvents()
      .then((body) => {
        if (cancelled) return;

        if (body.ok) {
          setState({ status: "ready", events: body.data.events });
        } else {
          setState({ status: "error", message: body.error.message });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function submitCreate(values: EventFormValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const body = await createEvent({
        name: values.name,
        description: values.description === "" ? null : values.description,
        timezone: values.timezone,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        allowManual: values.allowManual,
      });

      if (body.ok) {
        setShowCreate(false);
        navigate(eventOverviewPath(body.data.event.id));
        return;
      }

      setFormError(body.error.message);
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSubmitting(false);
    }
  }

  const canCreateEvent =
    session.status === "authenticated" &&
    (session.user.role === "superadmin" || session.user.role === "event_admin");

  return (
    <AppShell
      title="Acara"
      subtitle="Kelola acara dan peserta yang terdaftar"
      actions={
        canCreateEvent && !showCreate ? (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus aria-hidden="true" className="size-4" />
            Buat
          </Button>
        ) : undefined
      }
    >
      {session.status === "anonymous" && (
        <Notice tone="warning">
          Anda belum masuk.{" "}
          <AppLink className="underline underline-offset-4" href="/masuk">
            Masuk dengan kode pemulihan
          </AppLink>{" "}
          untuk mengelola acara.
        </Notice>
      )}

      {session.status === "error" && <ErrorState message={session.message} />}

      {showCreate && canCreateEvent && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Acara baru</h2>
          <EventForm
            mode="create"
            submitting={submitting}
            error={formError}
            onSubmit={submitCreate}
            onCancel={() => {
              setShowCreate(false);
              setFormError(null);
            }}
          />
        </section>
      )}

      {state.status === "loading" && <LoadingState label="Memuat acara…" />}

      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadKey((key) => key + 1)} />
      )}

      {state.status === "ready" && state.events.length === 0 && (
        <EmptyState>
          <CalendarDays aria-hidden="true" className="mx-auto mb-2 size-6" />
          Belum ada acara yang bisa Anda akses.
          {canCreateEvent
            ? " Buat acara pertama lewat tombol Buat."
            : " Minta admin menambahkan Anda ke acara."}
        </EmptyState>
      )}

      {state.status === "ready" && state.events.length > 0 && (
        <ul className="space-y-2">
          {state.events.map((event) => (
            <li key={event.id}>
              <AppLink
                href={eventOverviewPath(event.id)}
                className="group flex items-start gap-3 rounded-lg border p-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{event.name}</span>
                    <EventStatusBadge status={event.status} />
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {formatSchedule(event.startsAt, event.endsAt, event.timezone)}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {formatCount(event.participantCount)} peserta · {ACCESS_LABEL[event.accessRole]}
                  </p>
                </div>

                <ChevronRight
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </AppLink>
            </li>
          ))}
        </ul>
      )}

    </AppShell>
  );
}
