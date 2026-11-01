import type { EventSummary, EventSummaryPayload, ParticipantSummary } from "@absensi/shared";
import { allowedEventTransitions } from "@absensi/shared";
import {
  Archive,
  ChevronRight,
  Download,
  FileDown,
  FileUp,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { EventForm, type EventFormValues } from "@/components/event-form";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
} from "@/components/page-state";
import {
  ParticipantForm,
  type ParticipantFormValues,
} from "@/components/participant-form";
import { EventStatusBadge, ParticipantStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { changeEventStatus, deleteEvent, getEvent, getEventSummary, updateEvent } from "@/lib/events";
import { formatCount, formatDateTime, formatSchedule } from "@/lib/format";
import { EVENT_STATUS_DESCRIPTION, EVENT_STATUS_LABEL, EVENT_TRANSITION_LABEL } from "@/lib/labels";
import {
  createParticipant,
  listParticipants,
  participantExportUrl,
  participantTemplateUrl,
  type ParticipantListParams,
} from "@/lib/participants";
import { importPath, navigate, participantPath, type AppRoute } from "@/lib/router";
import { useSession } from "@/lib/session";

const PAGE_SIZE = 25;

type PageState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type ListStatus = ParticipantListParams["status"];

export function EventDetailPage({ route, eventId }: { route: AppRoute; eventId: string }) {
  const session = useSession();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [summary, setSummary] = useState<EventSummaryPayload | null>(null);
  const [pageState, setPageState] = useState<PageState>({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);

  const [queryInput, setQueryInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListStatus>("active");
  const [items, setItems] = useState<ParticipantSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [listKey, setListKey] = useState(0);

  const [showAdd, setShowAdd] = useState(false);
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

  useEffect(() => {
    let cancelled = false;

    setListState("loading");
    setListError("");

    listParticipants(eventId, {
      query: appliedQuery,
      status: statusFilter,
      limit: PAGE_SIZE,
    })
      .then((body) => {
        if (cancelled) return;

        if (body.ok) {
          setItems(body.data.items);
          setNextCursor(body.data.nextCursor);
          setListState("ready");
        } else {
          setListError(body.error.message);
          setListState("error");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setListError("Tidak bisa menghubungi server");
          setListState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, appliedQuery, statusFilter, listKey]);

  function refreshAll() {
    setRefreshKey((key) => key + 1);
    setListKey((key) => key + 1);
  }

  async function loadMore() {
    if (!nextCursor) return;

    setLoadingMore(true);
    setListError("");

    try {
      const body = await listParticipants(eventId, {
        query: appliedQuery,
        status: statusFilter,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });

      if (body.ok) {
        setItems((current) => [...current, ...body.data.items]);
        setNextCursor(body.data.nextCursor);
      } else {
        setListError(body.error.message);
      }
    } catch {
      setListError("Tidak bisa menghubungi server");
    } finally {
      setLoadingMore(false);
    }
  }

  async function submitAdd(values: ParticipantFormValues) {
    setSubmitting(true);
    setFormError(null);

    try {
      const body = await createParticipant(eventId, {
        fullName: values.fullName,
        ...(values.externalRef ? { externalRef: values.externalRef } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.email ? { email: values.email } : {}),
        ...(values.category ? { category: values.category } : {}),
        ...(values.note ? { note: values.note } : {}),
      });

      if (body.ok) {
        setShowAdd(false);
        setActionNotice(`Peserta ${body.data.participant.fullName} ditambahkan.`);
        refreshAll();
        return;
      }

      setFormError(body.error.message);
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSubmitting(false);
    }
  }

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
        navigate("/acara");
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
      <AppShell route={route} title="Acara" backTo="/acara">
        <LoadingState label="Memuat acara…" />
      </AppShell>
    );
  }

  if (pageState.status === "error" || event === null) {
    return (
      <AppShell route={route} title="Acara" backTo="/acara">
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
  const exportHref = participantExportUrl(eventId, {
    query: appliedQuery,
    status: statusFilter,
  });

  return (
    <AppShell
      route={route}
      title={event.name}
      subtitle={formatSchedule(event.startsAt, event.endsAt, event.timezone)}
      backTo="/acara"
      actions={<EventStatusBadge status={event.status} />}
    >
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

      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}

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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UsersRound aria-hidden="true" className="size-4" />
            Peserta
          </h2>

          {canWrite && !isArchived && (
            <div className="flex flex-wrap gap-2">
              <a
                href={importPath(eventId)}
                className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <FileUp aria-hidden="true" className="size-4" />
                Impor CSV
              </a>
              <a
                href={participantTemplateUrl(eventId)}
                download
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              >
                <FileDown aria-hidden="true" className="size-4" />
                Template
              </a>
              <a
                href={exportHref}
                download
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              >
                <Download aria-hidden="true" className="size-4" />
                Ekspor
              </a>
            </div>
          )}
        </div>

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            setAppliedQuery(queryInput);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Cari nama, referensi, telepon, email…"
              aria-label="Cari peserta"
            />
          </div>

          <Select
            className="w-36"
            aria-label="Filter status peserta"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ListStatus)}
          >
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
            <option value="all">Semua</option>
          </Select>

          <Button type="submit" variant="outline">
            Cari
          </Button>
        </form>

        {canWrite && !isArchived && (
          <div className="flex flex-wrap gap-2">
            {!showAdd ? (
              <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
                <Plus aria-hidden="true" className="size-4" />
                Tambah peserta
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAdd(false);
                  setFormError(null);
                }}
              >
                Tutup form
              </Button>
            )}
          </div>
        )}

        {showAdd && canWrite && !isArchived && (
          <ParticipantForm
            mode="create"
            submitting={submitting}
            error={formError}
            onSubmit={submitAdd}
            onCancel={() => {
              setShowAdd(false);
              setFormError(null);
            }}
          />
        )}

        {listState === "loading" && <LoadingState label="Memuat peserta…" />}

        {listState === "error" && (
          <ErrorState message={listError} onRetry={() => setListKey((key) => key + 1)} />
        )}

        {listState === "ready" && items.length === 0 && (
          <EmptyState>
            {appliedQuery.trim() === ""
              ? "Belum ada peserta pada filter ini."
              : `Tidak ada peserta yang cocok dengan “${appliedQuery.trim()}”.`}
          </EmptyState>
        )}

        {listState === "ready" && items.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {items.map((participant) => (
              <li key={participant.id}>
                <a
                  href={participantPath(eventId, participant.id)}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{participant.fullName}</span>
                      <ParticipantStatusBadge status={participant.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        participant.externalRef,
                        participant.category,
                        participant.phone ?? participant.email,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Tanpa detail kontak"}
                    </p>
                  </div>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}

        {nextCursor && listState === "ready" && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
              {loadingMore && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
              Muat lebih banyak
            </Button>
          </div>
        )}

        {listError && listState === "ready" && <ErrorState message={listError} />}

        {items.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            Menampilkan {formatCount(items.length)} peserta pada halaman ini.
          </p>
        )}
      </section>
    </AppShell>
  );
}
