import type { EventSummary, ParticipantSummary } from "@absensi/shared";
import { ChevronRight, Download, FileDown, FileUp, LoaderCircle, Plus, QrCode as QrCodeIcon, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { ParticipantForm, type ParticipantFormValues } from "@/components/participant-form";
import { ParticipantStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { getEvent } from "@/lib/events";
import { formatCount } from "@/lib/format";
import {
  createParticipant,
  listParticipants,
  participantExportUrl,
  participantTemplateUrl,
  type ParticipantListParams,
} from "@/lib/participants";
import { importPath, labelsPath, participantPath } from "@/lib/router";

const PAGE_SIZE = 25;

type EventState =
  | { status: "loading" }
  | { status: "ready"; event: EventSummary }
  | { status: "error"; message: string };

type ListStatus = ParticipantListParams["status"];

/** The event toolbar hands its search term over as `?q=`. */
function queryFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

/** `/admin/events/:id/participants` — search, add, import, and export. */
export function EventParticipantsPage({ eventId }: { eventId: string }) {
  const [eventState, setEventState] = useState<EventState>({ status: "loading" });

  const [queryInput, setQueryInput] = useState(queryFromUrl);
  const [appliedQuery, setAppliedQuery] = useState(queryFromUrl);
  const [statusFilter, setStatusFilter] = useState<ListStatus>("active");
  const [items, setItems] = useState<ParticipantSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [listKey, setListKey] = useState(0);

  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setEventState({ status: "loading" });

    getEvent(eventId)
      .then((body) => {
        if (cancelled) return;

        if (body.ok) {
          setEventState({ status: "ready", event: body.data.event });
        } else {
          setEventState({ status: "error", message: body.error.message });
        }
      })
      .catch(() => {
        if (!cancelled) setEventState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // The toolbar search can submit while this page is already mounted: the path
  // does not change, only `?q=`, so the route does not remount the page. Read
  // the term from the URL on every navigation instead.
  useEffect(() => {
    function syncFromUrl() {
      const next = queryFromUrl();
      setQueryInput(next);
      setAppliedQuery(next);
    }

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

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
        setListKey((key) => key + 1);
        return;
      }

      setFormError(body.error.message);
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSubmitting(false);
    }
  }

  if (eventState.status === "loading") {
    return (
      <AppShell title="Peserta">
        <LoadingState label="Memuat acara…" />
      </AppShell>
    );
  }

  if (eventState.status === "error") {
    return (
      <AppShell title="Peserta">
        <ErrorState message={eventState.message} />
      </AppShell>
    );
  }

  const { event } = eventState;
  const canWrite = event.accessRole !== "officer";
  const isArchived = event.status === "archived";
  const exportHref = participantExportUrl(eventId, {
    query: appliedQuery,
    status: statusFilter,
  });

  return (
    <AppShell title="Peserta" subtitle={event.name}>
      {actionNotice && <Notice tone="success">{actionNotice}</Notice>}

      {isArchived && (
        <Notice tone="warning">
          Acara sudah diarsipkan. Data peserta hanya dapat dibaca.
        </Notice>
      )}

      {!canWrite && !isArchived && (
        <Notice>Anda adalah petugas pada acara ini. Data hanya dapat dilihat.</Notice>
      )}

      <section className="space-y-3">
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <AppLink
              href={labelsPath(eventId)}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <QrCodeIcon aria-hidden="true" className="size-4" />
              Label QR
            </AppLink>
          </div>
        )}

        {canWrite && !isArchived && (
          <div className="flex flex-wrap gap-2">
            <AppLink
              href={importPath(eventId)}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <FileUp aria-hidden="true" className="size-4" />
              Impor CSV
            </AppLink>
            <a
              href={participantTemplateUrl(eventId)}
              download
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <FileDown aria-hidden="true" className="size-4" />
              Template
            </a>
            <a
              href={exportHref}
              download
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Download aria-hidden="true" className="size-4" />
              Ekspor
            </a>
          </div>
        )}

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
            formEvent.preventDefault();
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
              onChange={(inputEvent) => setQueryInput(inputEvent.target.value)}
              placeholder="Cari nama, referensi, telepon, email…"
              aria-label="Cari peserta"
            />
          </div>

          <Select
            className="w-36"
            aria-label="Filter status peserta"
            value={statusFilter}
            onChange={(selectEvent) => setStatusFilter(selectEvent.target.value as ListStatus)}
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
                <AppLink
                  href={participantPath(eventId, participant.id)}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
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
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </AppLink>
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
