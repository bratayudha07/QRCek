import type {
  Activity,
  ActivitySession,
  ActivityStatus,
  EventSummary,
  SessionStatus,
  TransactionType,
} from "@absensi/shared";
import { Archive, CalendarClock, Copy, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  activityStatusLabel,
  activityTransitionActions,
  canManageActivities,
  changeActivityStatus,
  createActivity,
  listActivities,
  listActivitySessions,
  transactionTypeLabel,
  updateActivity,
} from "@/lib/activities";
import {
  archiveActivitySession,
  canArchiveActivitySession,
  changeActivitySessionStatus,
  createActivitySession,
  duplicateActivitySession,
  sessionStatusLabel,
  sessionTimeRangeError,
  sessionTransitionActions,
  updateActivitySession,
} from "@/lib/activity-sessions";
import { epochToLocalInput, localInputToEpoch } from "@/lib/activity-time";
import { defaultActivityId } from "@/lib/entitlements";
import { getEvent } from "@/lib/events";
import { formatSchedule } from "@/lib/format";

const SORT_ORDER_MAX = 1_000_000;

type EventState =
  | { status: "loading" }
  | { status: "ready"; event: EventSummary }
  | { status: "error"; message: string };

type LoadState = "loading" | "ready" | "error";

type ActivityDialogState = { mode: "create" } | { mode: "edit"; activity: Activity };
type SessionDialogState = { mode: "create" } | { mode: "edit"; session: ActivitySession };

interface ActivityFormValues {
  name: string;
  description: string;
  transactionType: TransactionType;
  location: string;
  sortOrder: string;
}

interface SessionFormValues {
  name: string;
  location: string;
  startsAt: string;
  endsAt: string;
}

const EMPTY_ACTIVITY_FORM: ActivityFormValues = {
  name: "",
  description: "",
  transactionType: "attendance",
  location: "",
  sortOrder: "0",
};

const EMPTY_SESSION_FORM: SessionFormValues = {
  name: "",
  location: "",
  startsAt: "",
  endsAt: "",
};

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

function activityBadgeVariant(status: ActivityStatus): BadgeVariant {
  switch (status) {
    case "active":
      return "success";
    case "completed":
      return "outline";
    case "draft":
    case "archived":
      return "muted";
  }
}

function sessionBadgeVariant(status: SessionStatus): BadgeVariant {
  switch (status) {
    case "in_progress":
      return "success";
    case "scheduled":
      return "outline";
    case "completed":
      return "muted";
    case "disabled":
      return "destructive";
  }
}

/**
 * `/admin/events/:id/activities` — Q1 delta.
 *
 * One master-detail screen: the Aktivitas table, then the Sesi panel for the
 * selected Aktivitas. Session times are entered as wall-clock values in the
 * Tema timezone and converted with `activity-time`. Every mutation sends one
 * request and reloads the list after `ok`; the Worker stays authoritative, so
 * nothing is shown as saved before it answers.
 */
export function EventActivitiesPage({ eventId }: { eventId: string }) {
  const [eventState, setEventState] = useState<EventState>({ status: "loading" });
  const [eventKey, setEventKey] = useState(0);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesState, setActivitiesState] = useState<LoadState>("loading");
  const [activitiesError, setActivitiesError] = useState("");
  const [activitiesKey, setActivitiesKey] = useState(0);
  const [selectedActivityId, setSelectedActivityId] = useState("");

  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [sessionsState, setSessionsState] = useState<LoadState>("ready");
  const [sessionsError, setSessionsError] = useState("");
  const [sessionsKey, setSessionsKey] = useState(0);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [activityDialog, setActivityDialog] = useState<ActivityDialogState | null>(null);
  const [activityForm, setActivityForm] = useState<ActivityFormValues>(EMPTY_ACTIVITY_FORM);
  const [activityFormError, setActivityFormError] = useState<string | null>(null);
  const [savingActivity, setSavingActivity] = useState(false);

  const [sessionDialog, setSessionDialog] = useState<SessionDialogState | null>(null);
  const [sessionForm, setSessionForm] = useState<SessionFormValues>(EMPTY_SESSION_FORM);
  const [sessionFormError, setSessionFormError] = useState<string | null>(null);
  const [savingSession, setSavingSession] = useState(false);

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
  // Archived Aktivitas stay in the list (with a badge) so history is never
  // hidden; only the write actions are dropped.
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

        setActivities(body.data.activities);
        setActivitiesState("ready");
        setSelectedActivityId((current) =>
          body.data.activities.some((activity) => activity.id === current)
            ? current
            : (defaultActivityId(body.data.activities) ??
              body.data.activities[0]?.id ??
              ""),
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
    if (!selectedActivityId) {
      setSessions([]);
      setSessionsState("ready");
      setSessionsError("");
      return;
    }

    let cancelled = false;
    setSessionsState("loading");
    setSessionsError("");

    listActivitySessions(eventId, selectedActivityId)
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
  }, [eventId, selectedActivityId, sessionsKey]);

  // Switching Aktivitas by hand clears the previous result; creating one keeps
  // its success notice visible (the selected id changes programmatically).
  function selectActivity(activityId: string) {
    if (activityId === selectedActivityId) return;
    setNotice(null);
    setActionError(null);
    setSelectedActivityId(activityId);
  }

  const event = eventState.status === "ready" ? eventState.event : null;
  const canManage = event !== null && canManageActivities(event.accessRole, event.status);
  const timeZone = event?.timezone ?? "UTC";

  const selectedActivity =
    activities.find((activity) => activity.id === selectedActivityId) ?? null;
  const selectedActivityArchived =
    selectedActivity !== null &&
    (selectedActivity.status === "archived" || selectedActivity.archivedAt !== null);

  function reloadActivities() {
    setActivitiesKey((key) => key + 1);
  }

  function reloadSessions() {
    setSessionsKey((key) => key + 1);
  }

  // ── Aktivitas mutations ─────────────────────────────────────────────────
  function openActivityCreate() {
    setActivityForm(EMPTY_ACTIVITY_FORM);
    setActivityFormError(null);
    setActivityDialog({ mode: "create" });
  }

  function openActivityEdit(activity: Activity) {
    setActivityForm({
      name: activity.name,
      description: activity.description ?? "",
      transactionType: activity.transactionType,
      location: activity.location ?? "",
      sortOrder: String(activity.sortOrder),
    });
    setActivityFormError(null);
    setActivityDialog({ mode: "edit", activity });
  }

  async function submitActivity(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!activityDialog) return;

    const name = activityForm.name.trim();
    if (!name) {
      setActivityFormError("Nama Aktivitas wajib diisi");
      return;
    }

    const sortOrder = Number(activityForm.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > SORT_ORDER_MAX) {
      setActivityFormError(`Urutan harus bilangan bulat antara 0 dan ${SORT_ORDER_MAX}`);
      return;
    }

    setSavingActivity(true);
    setActivityFormError(null);

    try {
      const description = activityForm.description.trim() || null;
      const location = activityForm.location.trim() || null;
      const result =
        activityDialog.mode === "create"
          ? await createActivity(eventId, {
              name,
              description,
              transactionType: activityForm.transactionType,
              location,
              sortOrder,
            })
          : await updateActivity(eventId, activityDialog.activity.id, {
              name,
              description,
              location,
              sortOrder,
            });

      if (!result.ok) {
        setActivityFormError(result.error.message);
        return;
      }

      setActivityDialog(null);
      if (activityDialog.mode === "create") setSelectedActivityId(result.data.activity.id);
      setNotice(activityDialog.mode === "create" ? "Aktivitas dibuat." : "Aktivitas disimpan.");
      reloadActivities();
    } catch {
      setActivityFormError("Tidak bisa menghubungi server");
    } finally {
      setSavingActivity(false);
    }
  }

  async function changeStatus(activity: Activity, status: ActivityStatus) {
    if (
      status === "archived" &&
      !window.confirm(
        `Arsipkan Aktivitas “${activity.name}”? Aktivitas arsip tetap tampil, tetapi tidak bisa dipakai untuk transaksi baru.`,
      )
    ) {
      return;
    }

    setBusy(`activity:${activity.id}`);
    setNotice(null);
    setActionError(null);

    try {
      const result = await changeActivityStatus(eventId, activity.id, status);
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setNotice(`Status Aktivitas diubah menjadi ${activityStatusLabel(status)}.`);
      reloadActivities();
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setBusy(null);
    }
  }

  // ── Sesi mutations ──────────────────────────────────────────────────────
  function localValue(epoch: number | null): string {
    return epoch === null ? "" : epochToLocalInput(epoch, timeZone);
  }

  function openSessionCreate() {
    setSessionForm(EMPTY_SESSION_FORM);
    setSessionFormError(null);
    setSessionDialog({ mode: "create" });
  }

  function openSessionEdit(session: ActivitySession) {
    setSessionForm({
      name: session.name,
      location: session.location ?? "",
      startsAt: localValue(session.startsAt),
      endsAt: localValue(session.endsAt),
    });
    setSessionFormError(null);
    setSessionDialog({ mode: "edit", session });
  }

  async function submitSession(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!sessionDialog || !selectedActivity) return;

    const name = sessionForm.name.trim();
    if (!name) {
      setSessionFormError("Nama Sesi wajib diisi");
      return;
    }

    const startsAt =
      sessionForm.startsAt.trim() === ""
        ? null
        : localInputToEpoch(sessionForm.startsAt, timeZone);
    if (sessionForm.startsAt.trim() !== "" && startsAt === null) {
      setSessionFormError("Waktu mulai tidak dikenali");
      return;
    }

    const endsAt =
      sessionForm.endsAt.trim() === "" ? null : localInputToEpoch(sessionForm.endsAt, timeZone);
    if (sessionForm.endsAt.trim() !== "" && endsAt === null) {
      setSessionFormError("Waktu selesai tidak dikenali");
      return;
    }

    const rangeError = sessionTimeRangeError(startsAt, endsAt);
    if (rangeError) {
      setSessionFormError(rangeError);
      return;
    }

    setSavingSession(true);
    setSessionFormError(null);

    try {
      const input = {
        name,
        location: sessionForm.location.trim() || null,
        startsAt,
        endsAt,
      };
      const result =
        sessionDialog.mode === "create"
          ? await createActivitySession(eventId, selectedActivity.id, input)
          : await updateActivitySession(
              eventId,
              selectedActivity.id,
              sessionDialog.session.id,
              input,
            );

      if (!result.ok) {
        setSessionFormError(result.error.message);
        return;
      }

      setSessionDialog(null);
      setNotice(sessionDialog.mode === "create" ? "Sesi dibuat." : "Sesi disimpan.");
      reloadSessions();
    } catch {
      setSessionFormError("Tidak bisa menghubungi server");
    } finally {
      setSavingSession(false);
    }
  }

  async function changeSessionStatus(session: ActivitySession, status: SessionStatus) {
    if (!selectedActivity) return;

    setBusy(`session:${session.id}`);
    setNotice(null);
    setActionError(null);

    try {
      const result = await changeActivitySessionStatus(
        eventId,
        selectedActivity.id,
        session.id,
        status,
      );
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setNotice(`Status Sesi diubah menjadi ${sessionStatusLabel(status)}.`);
      reloadSessions();
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setBusy(null);
    }
  }

  async function duplicateSession(session: ActivitySession) {
    if (!selectedActivity) return;

    setBusy(`session:${session.id}`);
    setNotice(null);
    setActionError(null);

    try {
      const result = await duplicateActivitySession(
        eventId,
        selectedActivity.id,
        session.id,
      );
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setNotice("Sesi diduplikasi sebagai Sesi baru berstatus Terjadwal.");
      reloadSessions();
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setBusy(null);
    }
  }

  async function archiveSession(session: ActivitySession) {
    if (!selectedActivity) return;
    if (!window.confirm(`Arsipkan Sesi “${session.name}”? Riwayat transaksi tetap tersimpan.`)) {
      return;
    }

    setBusy(`session:${session.id}`);
    setNotice(null);
    setActionError(null);

    try {
      const result = await archiveActivitySession(eventId, selectedActivity.id, session.id);
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setNotice("Sesi diarsipkan.");
      reloadSessions();
    } catch {
      setActionError("Tidak bisa menghubungi server");
    } finally {
      setBusy(null);
    }
  }

  if (eventState.status === "loading") {
    return (
      <AppShell variant="embedded" title="Aktivitas & Sesi">
        <LoadingState label="Memuat Tema…" />
      </AppShell>
    );
  }

  if (eventState.status === "error") {
    return (
      <AppShell variant="embedded" title="Aktivitas & Sesi">
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
        ? "Tema sudah diarsipkan. Aktivitas dan Sesi hanya bisa dilihat."
        : event.accessRole === "officer"
          ? "Petugas hanya bisa melihat Aktivitas dan Sesi. Hubungi Admin Acara untuk mengubahnya."
          : null;

  return (
    <AppShell
      variant="embedded"
      title="Aktivitas & Sesi"
      subtitle="Buat Aktivitas dan Sesi. Jenis transaksi ditentukan saat Aktivitas dibuat dan tidak bisa diubah."
    >
      {readOnlyMessage && <Notice tone="warning">{readOnlyMessage}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {actionError && (
        <ErrorState
          message={actionError}
          onRetry={() => {
            reloadActivities();
            reloadSessions();
          }}
        />
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarClock aria-hidden="true" className="size-4" />
              Aktivitas
            </h2>
            <p className="text-sm text-muted-foreground">
              Aktivitas adalah unit transaksi. Aktivitas tanpa Sesi dicatat per Aktivitas; Aktivitas
              dengan Sesi dicatat per Sesi.
            </p>
          </div>
          {canManage && (
            <Button
              type="button"
              size="sm"
              onClick={openActivityCreate}
              disabled={busy !== null}
            >
              <Plus aria-hidden="true" className="size-4" />
              Tambah Aktivitas
            </Button>
          )}
        </div>

        {activitiesState === "loading" ? (
          <LoadingState label="Memuat Aktivitas…" />
        ) : activitiesState === "error" ? (
          <ErrorState message={activitiesError} onRetry={reloadActivities} />
        ) : activities.length === 0 ? (
          <EmptyState>
            Belum ada Aktivitas. Buat Aktivitas pertama agar Petugas bisa memindai.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Lokasi</TableHead>
                <TableHead>Urutan</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((activity) => {
                const archived =
                  activity.status === "archived" || activity.archivedAt !== null;
                const selected = activity.id === selectedActivityId;

                return (
                  <TableRow key={activity.id}>
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-2">
                        {activity.name}
                        {archived && <Badge variant="muted">Diarsipkan</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>{transactionTypeLabel(activity.transactionType)}</TableCell>
                    <TableCell>
                      <Badge variant={activityBadgeVariant(activity.status)}>
                        {activityStatusLabel(activity.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{activity.location ?? "—"}</TableCell>
                    <TableCell>{activity.sortOrder}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          aria-pressed={selected}
                          onClick={() => selectActivity(activity.id)}
                        >
                          Sesi
                        </Button>

                        {canManage && !archived && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => openActivityEdit(activity)}
                            >
                              Ubah
                            </Button>
                            {activityTransitionActions(activity.status).map((action) => (
                              <Button
                                key={action.status}
                                type="button"
                                size="sm"
                                variant={action.status === "archived" ? "destructive" : "outline"}
                                disabled={busy !== null}
                                onClick={() => void changeStatus(activity, action.status)}
                              >
                                {action.label}
                              </Button>
                            ))}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {selectedActivity && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="font-semibold">Sesi · {selectedActivity.name}</h2>
              <p className="text-sm text-muted-foreground">
                Waktu Sesi ditafsirkan dalam zona waktu Tema ({timeZone}), bukan zona waktu
                perangkat. Status tidak pernah disimpulkan dari jam.
              </p>
            </div>
            {canManage && !selectedActivityArchived && (
              <Button
                type="button"
                size="sm"
                onClick={openSessionCreate}
                disabled={busy !== null}
              >
                <Plus aria-hidden="true" className="size-4" />
                Tambah Sesi
              </Button>
            )}
          </div>

          {sessionsState === "loading" ? (
            <LoadingState label="Memuat Sesi…" />
          ) : sessionsState === "error" ? (
            <ErrorState message={sessionsError} onRetry={reloadSessions} />
          ) : sessions.length === 0 ? (
            <EmptyState>
              Aktivitas ini belum punya Sesi. Transaksi akan dicatat per Aktivitas sampai Sesi
              dibuat.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Lokasi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => {
                  const archived = session.archivedAt !== null;

                  return (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {session.name}
                          {archived && <Badge variant="muted">Diarsipkan</Badge>}
                        </span>
                      </TableCell>
                      <TableCell>
                        {formatSchedule(session.startsAt, session.endsAt, timeZone)}
                      </TableCell>
                      <TableCell>{session.location ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={sessionBadgeVariant(session.status)}>
                          {sessionStatusLabel(session.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && !selectedActivityArchived && !archived && (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => openSessionEdit(session)}
                            >
                              Ubah
                            </Button>
                            {sessionTransitionActions(session.status).map((action) => (
                              <Button
                                key={action.status}
                                type="button"
                                size="sm"
                                variant={action.status === "disabled" ? "destructive" : "outline"}
                                disabled={busy !== null}
                                onClick={() => void changeSessionStatus(session, action.status)}
                              >
                                {action.label}
                              </Button>
                            ))}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void duplicateSession(session)}
                            >
                              <Copy aria-hidden="true" className="size-4" />
                              Duplikat
                            </Button>
                            {canArchiveActivitySession(session) && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy !== null}
                                onClick={() => void archiveSession(session)}
                              >
                                <Archive aria-hidden="true" className="size-4" />
                                Arsipkan
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      <Dialog
        open={activityDialog !== null}
        onClose={() => setActivityDialog(null)}
        ariaLabel={activityDialog?.mode === "edit" ? "Ubah Aktivitas" : "Tambah Aktivitas"}
      >
        <form className="space-y-4" onSubmit={(formEvent) => void submitActivity(formEvent)}>
          <DialogHeader>
            <DialogTitle>
              {activityDialog?.mode === "edit" ? "Ubah Aktivitas" : "Tambah Aktivitas"}
            </DialogTitle>
            <DialogDescription>
              Aktivitas menentukan jenis transaksi. Jenis yang salah diperbaiki dengan membuat
              Aktivitas baru, bukan dengan mengubah yang lama.
            </DialogDescription>
          </DialogHeader>

          <Field label="Nama" htmlFor="activity-name" required>
            <Input
              id="activity-name"
              value={activityForm.name}
              maxLength={120}
              autoFocus
              onChange={(changeEvent) =>
                setActivityForm((current) => ({ ...current, name: changeEvent.target.value }))
              }
            />
          </Field>

          <Field label="Deskripsi (opsional)" htmlFor="activity-description">
            <Textarea
              id="activity-description"
              value={activityForm.description}
              maxLength={500}
              onChange={(changeEvent) =>
                setActivityForm((current) => ({
                  ...current,
                  description: changeEvent.target.value,
                }))
              }
            />
          </Field>

          {activityDialog?.mode === "edit" ? (
            <Field label="Jenis transaksi">
              <p className="rounded-md border bg-muted/50 p-2 text-sm">
                {transactionTypeLabel(activityDialog.activity.transactionType)} · jenis tidak bisa
                diubah setelah Aktivitas dibuat.
              </p>
            </Field>
          ) : (
            <Field label="Jenis transaksi" htmlFor="activity-transaction-type" required>
              <Select
                id="activity-transaction-type"
                value={activityForm.transactionType}
                onChange={(changeEvent) =>
                  setActivityForm((current) => ({
                    ...current,
                    transactionType: changeEvent.target.value as TransactionType,
                  }))
                }
              >
                <option value="attendance">Absensi</option>
                <option value="consumption">Konsumsi</option>
              </Select>
            </Field>
          )}

          <Field label="Lokasi (opsional)" htmlFor="activity-location">
            <Input
              id="activity-location"
              value={activityForm.location}
              maxLength={200}
              onChange={(changeEvent) =>
                setActivityForm((current) => ({ ...current, location: changeEvent.target.value }))
              }
            />
          </Field>

          <Field label="Urutan" htmlFor="activity-sort-order" hint="Angka lebih kecil tampil lebih dulu.">
            <Input
              id="activity-sort-order"
              type="number"
              min={0}
              max={SORT_ORDER_MAX}
              step={1}
              value={activityForm.sortOrder}
              onChange={(changeEvent) =>
                setActivityForm((current) => ({
                  ...current,
                  sortOrder: changeEvent.target.value,
                }))
              }
            />
          </Field>

          {activityFormError && (
            <p
              role="alert"
              className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
            >
              {activityFormError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setActivityDialog(null)}
              disabled={savingActivity}
            >
              Batal
            </Button>
            <Button type="submit" disabled={savingActivity}>
              Simpan Aktivitas
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog
        open={sessionDialog !== null}
        onClose={() => setSessionDialog(null)}
        ariaLabel={sessionDialog?.mode === "edit" ? "Ubah Sesi" : "Tambah Sesi"}
      >
        <form className="space-y-4" onSubmit={(formEvent) => void submitSession(formEvent)}>
          <DialogHeader>
            <DialogTitle>
              {sessionDialog?.mode === "edit" ? "Ubah Sesi" : "Tambah Sesi"}
            </DialogTitle>
            <DialogDescription>
              Waktu diisi dalam zona waktu Tema ({timeZone}). Status Sesi diubah lewat tombol, bukan
              dari jam.
            </DialogDescription>
          </DialogHeader>

          <Field label="Nama" htmlFor="session-name" required>
            <Input
              id="session-name"
              value={sessionForm.name}
              maxLength={120}
              autoFocus
              onChange={(changeEvent) =>
                setSessionForm((current) => ({ ...current, name: changeEvent.target.value }))
              }
            />
          </Field>

          <Field label="Lokasi (opsional)" htmlFor="session-location">
            <Input
              id="session-location"
              value={sessionForm.location}
              maxLength={200}
              onChange={(changeEvent) =>
                setSessionForm((current) => ({ ...current, location: changeEvent.target.value }))
              }
            />
          </Field>

          <Field label="Mulai (opsional)" htmlFor="session-starts-at">
            <Input
              id="session-starts-at"
              type="datetime-local"
              value={sessionForm.startsAt}
              onChange={(changeEvent) =>
                setSessionForm((current) => ({ ...current, startsAt: changeEvent.target.value }))
              }
            />
          </Field>

          <Field label="Selesai (opsional)" htmlFor="session-ends-at">
            <Input
              id="session-ends-at"
              type="datetime-local"
              value={sessionForm.endsAt}
              onChange={(changeEvent) =>
                setSessionForm((current) => ({ ...current, endsAt: changeEvent.target.value }))
              }
            />
          </Field>

          {sessionFormError && (
            <p
              role="alert"
              className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
            >
              {sessionFormError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSessionDialog(null)}
              disabled={savingSession}
            >
              Batal
            </Button>
            <Button type="submit" disabled={savingSession}>
              Simpan Sesi
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </AppShell>
  );
}
