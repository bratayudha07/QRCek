import type {
  Activity,
  ActivitySession,
  ActivityStatus,
  EntitlementMatrixPayload,
  EntitlementStatus,
  EventSummary,
  ParticipantSummary,
} from "@absensi/shared";
import { LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listActivities, listActivitySessions } from "@/lib/activities";
import {
  ACTIVITY_SCOPE_KEY,
  canEditEntitlements,
  categoryRows,
  defaultActivityId,
  deleteActivityParticipantOverride,
  deleteSessionParticipantOverride,
  deleteThemeDefault,
  entitlementStatusLabel,
  getActivityEntitlements,
  missingCategoryNames,
  overrideRows,
  putActivityCategoryRules,
  putActivityParticipantOverride,
  putSessionCategoryRules,
  putSessionParticipantOverride,
  putThemeDefault,
  scopeOptions,
  type EntitlementOverrideRow,
} from "@/lib/entitlements";
import { getEvent } from "@/lib/events";
import { listParticipants } from "@/lib/participants";
import { participantsPath } from "@/lib/router";

const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  draft: "Draf",
  active: "Aktif",
  completed: "Selesai",
  archived: "Diarsipkan",
};

const SEARCH_LIMIT = 20;

type EventState =
  | { status: "loading" }
  | { status: "ready"; event: EventSummary }
  | { status: "error"; message: string };

type LoadState = "loading" | "ready" | "error";

/**
 * `/admin/events/:id/entitlements` — Q3 delta.
 *
 * The Worker remains authoritative for every write; this page only renders the
 * matrix and sends one request per change. Nothing is shown as saved before the
 * API answers `ok`.
 */
export function EventEntitlementsPage({ eventId }: { eventId: string }) {
  const [eventState, setEventState] = useState<EventState>({ status: "loading" });
  const [eventKey, setEventKey] = useState(0);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesState, setActivitiesState] = useState<LoadState>("loading");
  const [activitiesError, setActivitiesError] = useState("");
  const [activitiesKey, setActivitiesKey] = useState(0);
  const [activityId, setActivityId] = useState("");

  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [sessionsState, setSessionsState] = useState<LoadState>("loading");
  const [sessionsError, setSessionsError] = useState("");
  const [scopeSessionId, setScopeSessionId] = useState<string | null>(null);

  const [matrix, setMatrix] = useState<EntitlementMatrixPayload | null>(null);
  const [matrixState, setMatrixState] = useState<LoadState>("loading");
  const [matrixError, setMatrixError] = useState("");
  const [matrixKey, setMatrixKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [searchState, setSearchState] = useState<LoadState>("ready");
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState<ParticipantSummary[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantSummary | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<"allowed" | "denied">("allowed");
  const [formError, setFormError] = useState<string | null>(null);
  const [savingOverride, setSavingOverride] = useState(false);

  // ── Tema ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setEventState({ status: "loading" });

    getEvent(eventId)
      .then((body) => {
        if (cancelled) return;
        if (body.ok) setEventState({ status: "ready", event: body.data.event });
        else setEventState({ status: "error", message: body.error.message });
      })
      .catch(() => {
        if (!cancelled) setEventState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, eventKey]);

  // ── Aktivitas ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setActivitiesState("loading");
    setActivitiesError("");

    listActivities(eventId)
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          setActivitiesState("error");
          setActivitiesError(body.error.message);
          return;
        }

        const list = body.data.activities.filter((activity) => activity.archivedAt === null);
        setActivities(list);
        setActivitiesState("ready");
        setActivityId((current) =>
          list.some((activity) => activity.id === current)
            ? current
            : (defaultActivityId(list) ?? ""),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setActivitiesState("error");
          setActivitiesError("Tidak bisa menghubungi server");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, activitiesKey]);

  // ── Sesi for the selected Aktivitas ─────────────────────────────────────
  useEffect(() => {
    if (!activityId) {
      setSessions([]);
      setSessionsState("ready");
      return;
    }

    let cancelled = false;
    setSessionsState("loading");
    setSessionsError("");

    listActivitySessions(eventId, activityId)
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          setSessionsState("error");
          setSessionsError(body.error.message);
          return;
        }
        setSessions(body.data.sessions);
        setSessionsState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setSessionsState("error");
          setSessionsError("Tidak bisa menghubungi server");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, activityId]);

  // A different Aktivitas means a different matrix and a different scope.
  useEffect(() => {
    setMatrix(null);
    setMatrixState("loading");
    setMatrixError("");
    setScopeSessionId(null);
    setNotice(null);
    setActionError(null);
  }, [activityId]);

  // ── Matrix ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activityId) return;

    let cancelled = false;
    setMatrixState((current) => (current === "ready" ? current : "loading"));
    setRefreshing(true);
    setMatrixError("");

    getActivityEntitlements(eventId, activityId)
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          setMatrixState("error");
          setMatrixError(body.error.message);
          return;
        }
        setMatrix(body.data);
        setMatrixState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setMatrixState("error");
          setMatrixError("Tidak bisa menghubungi server");
        }
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, activityId, matrixKey]);

  // Names for existing overrides. The API only sends ids; the first page is
  // enough for the common case, and `overrideRows` falls back to a short id.
  useEffect(() => {
    let cancelled = false;

    listParticipants(eventId, { status: "all", limit: SEARCH_LIMIT })
      .then((body) => {
        if (cancelled || !body.ok) return;
        mergeNames(body.data.items);
      })
      .catch(() => {
        // Names are cosmetic; the id fallback keeps the rules visible.
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  function mergeNames(items: readonly ParticipantSummary[]) {
    setParticipantNames((current) => {
      const next = { ...current };
      for (const item of items) next[item.id] = item.fullName;
      return next;
    });
  }

  const event = eventState.status === "ready" ? eventState.event : null;
  const canEdit = event !== null && canEditEntitlements(event.accessRole, event.status);
  const selectedActivity = activities.find((activity) => activity.id === activityId) ?? null;
  const scopes = selectedActivity ? scopeOptions(selectedActivity, sessions) : [];
  const selectedScope =
    scopes.find((scope) => scope.sessionId === scopeSessionId) ?? scopes[0] ?? null;

  const rows = matrix ? categoryRows(matrix, scopeSessionId) : [];
  const overrides = matrix ? overrideRows(matrix, scopeSessionId, participantNames) : [];
  const missingNames = matrix ? missingCategoryNames(matrix) : [];
  const themeDefaultStatus = matrix?.themeDefault?.status ?? null;

  function reloadMatrix() {
    setMatrixKey((key) => key + 1);
  }

  async function saveThemeDefault(status: "allowed" | "denied" | null) {
    if (!canEdit) return;

    setBusy("default");
    setNotice(null);
    setActionError(null);

    try {
      const result =
        status === null
          ? await deleteThemeDefault(eventId)
          : await putThemeDefault(eventId, { status });

      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setNotice(status === null ? "Fallback Tema dihapus." : "Fallback Tema disimpan.");
      reloadMatrix();
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setBusy(null);
    }
  }

  async function saveCategory(categoryId: string, status: EntitlementStatus) {
    if (!canEdit || !activityId) return;

    setBusy(`category:${categoryId}`);
    setNotice(null);
    setActionError(null);

    try {
      const input = { rules: [{ categoryId, status }] };
      const result =
        scopeSessionId === null
          ? await putActivityCategoryRules(eventId, activityId, input)
          : await putSessionCategoryRules(eventId, activityId, scopeSessionId, input);

      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setNotice("Aturan kategori disimpan.");
      reloadMatrix();
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setBusy(null);
    }
  }

  async function removeOverride(row: EntitlementOverrideRow) {
    if (!canEdit || !activityId) return;
    if (!window.confirm(`Hapus override untuk ${row.name}?`)) return;

    setBusy(`override:${row.participantId}`);
    setNotice(null);
    setActionError(null);

    try {
      const result =
        scopeSessionId === null
          ? await deleteActivityParticipantOverride(eventId, activityId, row.participantId)
          : await deleteSessionParticipantOverride(
              eventId,
              activityId,
              scopeSessionId,
              row.participantId,
            );

      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setNotice("Override peserta dihapus.");
      reloadMatrix();
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setBusy(null);
    }
  }

  function openDialog() {
    setSearchQuery("");
    setAppliedSearch("");
    setSelectedParticipant(null);
    setOverrideStatus("allowed");
    setFormError(null);
    setSearchError("");
    setResults([]);
    setSearchState("loading");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setFormError(null);
  }

  // Dialog search: the applied term drives the request, so submitting the form
  // does not need its own effect.
  useEffect(() => {
    if (!dialogOpen) return;

    let cancelled = false;
    setSearchState("loading");
    setSearchError("");

    listParticipants(eventId, {
      query: appliedSearch,
      status: "all",
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
        mergeNames(body.data.items);
      })
      .catch(() => {
        if (!cancelled) {
          setSearchState("error");
          setSearchError("Tidak bisa menghubungi server");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dialogOpen, eventId, appliedSearch]);

  function submitSearch(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setAppliedSearch(searchQuery.trim());
  }

  async function submitOverride() {
    if (!canEdit || !activityId || !selectedParticipant) return;

    setSavingOverride(true);
    setFormError(null);

    try {
      const input = { status: overrideStatus };
      const result =
        scopeSessionId === null
          ? await putActivityParticipantOverride(
              eventId,
              activityId,
              selectedParticipant.id,
              input,
            )
          : await putSessionParticipantOverride(
              eventId,
              activityId,
              scopeSessionId,
              selectedParticipant.id,
              input,
            );

      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }

      mergeNames([selectedParticipant]);
      setDialogOpen(false);
      setNotice("Override peserta disimpan.");
      reloadMatrix();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSavingOverride(false);
    }
  }

  if (eventState.status === "loading") {
    return (
      <AppShell variant="embedded" title="Hak Peserta">
        <LoadingState label="Memuat Tema…" />
      </AppShell>
    );
  }

  if (eventState.status === "error") {
    return (
      <AppShell variant="embedded" title="Hak Peserta">
        <ErrorState
          message={eventState.message}
          onRetry={() => setEventKey((key) => key + 1)}
        />
      </AppShell>
    );
  }

  const readOnlyMessage =
    event === null
      ? null
      : event.status === "archived"
        ? "Tema sudah diarsipkan. Hak peserta hanya bisa dilihat."
        : event.accessRole === "officer"
          ? "Petugas hanya bisa melihat hak peserta. Hubungi Admin Acara untuk mengubahnya."
          : null;

  return (
    <AppShell
      variant="embedded"
      title="Hak Peserta"
      subtitle="Atur hak peserta per Aktivitas dan Sesi. Aturan kategori adalah kontrol utama; override peserta adalah pengecualian."
    >
      {readOnlyMessage && <Notice tone="warning">{readOnlyMessage}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {actionError && <ErrorState message={actionError} onRetry={reloadMatrix} />}

      <section className="space-y-3 rounded-xl border p-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldCheck aria-hidden="true" className="size-4" />
            Aktivitas
          </h2>
          <p className="text-sm text-muted-foreground">
            Hak peserta disimpan per Aktivitas. Bila Aktivitas punya Sesi, aturan Sesi menang atas
            aturan Aktivitas.
          </p>
        </div>

        {activitiesState === "loading" ? (
          <LoadingState label="Memuat Aktivitas…" />
        ) : activitiesState === "error" ? (
          <ErrorState
            message={activitiesError}
            onRetry={() => setActivitiesKey((key) => key + 1)}
          />
        ) : activities.length === 0 ? (
          <EmptyState>
            Belum ada Aktivitas aktif. Buat Aktivitas terlebih dahulu sebelum mengatur hak peserta.
          </EmptyState>
        ) : (
          <Field label="Pilih Aktivitas" htmlFor="entitlement-activity">
            <Select
              id="entitlement-activity"
              value={activityId}
              onChange={(changeEvent) => setActivityId(changeEvent.target.value)}
            >
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name} · {ACTIVITY_STATUS_LABEL[activity.status]}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </section>

      {selectedActivity && (
        <>
          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="font-semibold">Fallback Tema</h2>
                <p className="text-sm text-muted-foreground">
                  Dipakai hanya bila Aktivitas, Sesi, kategori, dan peserta tidak menentukan apa pun.
                  Tanpa fallback, transaksi ditolak.
                </p>
              </div>
              <Badge variant={themeDefaultStatus === null ? "muted" : "outline"}>
                {matrixState === "ready"
                  ? entitlementStatusLabel(themeDefaultStatus)
                  : matrixState === "error"
                    ? "Tidak tersedia"
                    : "Memuat…"}
              </Badge>
            </div>

            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy !== null || matrixState !== "ready"}
                  onClick={() => void saveThemeDefault("allowed")}
                >
                  Izinkan semua
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || matrixState !== "ready"}
                  onClick={() => void saveThemeDefault("denied")}
                >
                  Tolak semua
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null || matrixState !== "ready" || themeDefaultStatus === null}
                  onClick={() => void saveThemeDefault(null)}
                >
                  Hapus fallback
                </Button>
              </div>
            )}
          </section>

          {matrixState === "loading" ? (
            <LoadingState label="Memuat matriks hak peserta…" />
          ) : matrixState === "error" ? (
            <ErrorState message={matrixError} onRetry={reloadMatrix} />
          ) : matrix ? (
            <>
              {!matrix.entitlementComplete && (
                <Notice tone="warning">
                  Kategori berikut belum punya aturan pada Aktivitas ini:{" "}
                  <strong>{missingNames.join(", ")}</strong>. Pilih aturannya pada tabel “Aturan
                  kategori” di bawah agar hak peserta tidak bergantung pada fallback.
                </Notice>
              )}

              <section className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="font-semibold">Ruang lingkup</h2>
                    <p className="text-sm text-muted-foreground">
                      Pilih seluruh Aktivitas atau satu Sesi. Aturan Sesi tidak berlaku untuk Sesi
                      lain.
                    </p>
                  </div>
                  {refreshing && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                      Menyegarkan
                    </span>
                  )}
                </div>

                {sessionsState === "error" ? (
                  <ErrorState message={sessionsError} />
                ) : (
                  <Field label="Berlaku untuk" htmlFor="entitlement-scope">
                    <Select
                      id="entitlement-scope"
                      value={scopeSessionId ?? ACTIVITY_SCOPE_KEY}
                      onChange={(changeEvent) => {
                        setNotice(null);
                        setActionError(null);
                        setScopeSessionId(
                          changeEvent.target.value === ACTIVITY_SCOPE_KEY
                            ? null
                            : changeEvent.target.value,
                        );
                      }}
                    >
                      {scopes.map((scope) => (
                        <option key={scope.key} value={scope.key}>
                          {scope.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {sessionsState === "loading" && (
                  <p className="text-xs text-muted-foreground">Memuat Sesi…</p>
                )}
              </section>

              <section className="space-y-3">
                <div className="space-y-1">
                  <h2 className="font-semibold">Aturan kategori</h2>
                  <p className="text-sm text-muted-foreground">
                    “Ikut bawaan” melanjutkan ke aturan berikutnya; “Diizinkan” atau “Ditolak”
                    menghentikan rantai. Setiap perubahan langsung disimpan.
                  </p>
                </div>

                {rows.length === 0 ? (
                  <EmptyState>
                    Belum ada kategori pada Aktivitas ini.{" "}
                    <AppLink href={participantsPath(eventId)} className="underline">
                      Kelola kategori di tab Peserta
                    </AppLink>
                    .
                  </EmptyState>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kategori</TableHead>
                        <TableHead>Aturan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.categoryId}>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell>
                            {canEdit ? (
                              <Select
                                aria-label={`Aturan kategori ${row.name}`}
                                value={row.status ?? "unset"}
                                disabled={busy !== null}
                                onChange={(changeEvent) => {
                                  const next = changeEvent.target.value;
                                  if (next === "unset") return;
                                  void saveCategory(row.categoryId, next as EntitlementStatus);
                                }}
                              >
                                {row.status === null && (
                                  <option value="unset" disabled>
                                    Belum diatur
                                  </option>
                                )}
                                <option value="inherit">Ikut bawaan</option>
                                <option value="allowed">Diizinkan</option>
                                <option value="denied">Ditolak</option>
                              </Select>
                            ) : (
                              <Badge variant={row.status === null ? "muted" : "outline"}>
                                {entitlementStatusLabel(row.status)}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="font-semibold">Override peserta</h2>
                    <p className="text-sm text-muted-foreground">
                      Override individual menang atas aturan kategori pada ruang lingkup ini.
                    </p>
                  </div>
                  {canEdit && (
                    <Button type="button" size="sm" onClick={openDialog} disabled={busy !== null}>
                      <Plus aria-hidden="true" className="size-4" />
                      Tambah override
                    </Button>
                  )}
                </div>

                {overrides.length === 0 ? (
                  <EmptyState>Belum ada override peserta pada ruang lingkup ini.</EmptyState>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Peserta</TableHead>
                        <TableHead>Status</TableHead>
                        {canEdit && <TableHead className="text-right">Aksi</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overrides.map((row) => (
                        <TableRow key={row.participantId}>
                          <TableCell className={row.nameFromId ? "text-muted-foreground" : "font-medium"}>
                            {row.name}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                row.status === "allowed"
                                  ? "success"
                                  : row.status === "denied"
                                    ? "destructive"
                                    : "muted"
                              }
                            >
                              {entitlementStatusLabel(row.status)}
                            </Badge>
                          </TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy !== null}
                                onClick={() => void removeOverride(row)}
                              >
                                <Trash2 aria-hidden="true" className="size-4" />
                                Hapus
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>
            </>
          ) : null}
        </>
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} ariaLabel="Tambah override peserta">
        <DialogHeader>
          <DialogTitle>Tambah override peserta</DialogTitle>
          <DialogDescription>
            Override hanya berlaku pada {selectedScope?.label ?? "Aktivitas (semua Sesi)"}.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={submitSearch}>
          <Field label="Cari peserta" htmlFor="entitlement-search">
            <div className="flex gap-2">
              <Input
                id="entitlement-search"
                value={searchQuery}
                onChange={(changeEvent) => setSearchQuery(changeEvent.target.value)}
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
          <ErrorState message={searchError} />
        ) : results.length === 0 ? (
          <EmptyState>Tidak ada peserta yang cocok.</EmptyState>
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
                        {participant.category ?? "Tanpa kategori"}
                      </span>
                    </span>
                    {selected && <Badge variant="outline">Dipilih</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Field label="Status override" htmlFor="entitlement-override-status" className="mt-4">
          <Select
            id="entitlement-override-status"
            value={overrideStatus}
            onChange={(changeEvent) =>
              setOverrideStatus(changeEvent.target.value as "allowed" | "denied")
            }
          >
            <option value="allowed">Diizinkan</option>
            <option value="denied">Ditolak</option>
          </Select>
        </Field>

        {formError && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
          >
            {formError}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeDialog} disabled={savingOverride}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={savingOverride || selectedParticipant === null}
            onClick={() => void submitOverride()}
          >
            Simpan override
          </Button>
        </DialogFooter>
      </Dialog>
    </AppShell>
  );
}
