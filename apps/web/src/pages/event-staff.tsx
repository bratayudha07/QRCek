import type {
  Activity,
  ActivitySession,
  InviteCreatedPayload,
  InviteSummary,
  MemberSummary,
  StaffAssignment,
} from "@absensi/shared";
import {
  Copy,
  ListChecks,
  Plus,
  QrCode as QrCodeIcon,
  Share2,
  UserCog,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { QrCode } from "@/components/qr-code";
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
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
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
  createAssignment,
  listEventAssignments,
  revokeAssignment,
  updateAssignmentManualFlag,
  type AssignmentStatusFilter,
} from "@/lib/assignments";
import {
  createEventInvite,
  deleteEventInvite,
  listEventInvites,
  listEventMembers,
  revokeEventMember,
} from "@/lib/event-admin";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface StaffData {
  members: MemberSummary[];
  invites: InviteSummary[];
}

export function EventStaffPage({ eventId }: { eventId: string }) {
  const session = useSession();
  const [data, setData] = useState<StaffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"officer" | "event_admin">("officer");
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [createdInvite, setCreatedInvite] = useState<InviteCreatedPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listEventMembers(eventId), listEventInvites(eventId)])
      .then(([members, invites]) => {
        if (cancelled) return;
        if (!members.ok || !invites.ok) {
          setError(!members.ok ? members.error.message : !invites.ok ? invites.error.message : "Gagal memuat petugas");
          return;
        }
        setData({ members: members.data.members, invites: invites.data.invites });
      })
      .catch(() => {
        if (!cancelled) setError("Tidak bisa menghubungi server");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [eventId, refresh]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createEventInvite(eventId, {
        role,
        expiresInHours,
        ...(name.trim() ? { invitedName: name.trim() } : {}),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCreatedInvite(result.data);
      setName("");
      setRefresh((value) => value + 1);
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!createdInvite) return;
    const url = `${window.location.origin}${createdInvite.activatePath}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Tautan aktivasi disalin. Tautan hanya ditampilkan kali ini.");
    } catch {
      const temporaryInput = document.createElement("textarea");
      temporaryInput.value = url;
      temporaryInput.setAttribute("readonly", "");
      temporaryInput.style.position = "fixed";
      temporaryInput.style.opacity = "0";
      document.body.append(temporaryInput);
      temporaryInput.select();
      const copied = document.execCommand("copy");
      temporaryInput.remove();
      setNotice(copied ? "Tautan aktivasi disalin." : "Salin tautan secara manual dari kotak tautan.");
    }
  }

  async function shareInvite() {
    if (!createdInvite) return;
    const url = `${window.location.origin}${createdInvite.activatePath}`;
    setNotice("Membuka opsi berbagi undangan…");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Undangan petugas Absensi", text: "Buka tautan ini untuk mengaktifkan akun petugas.", url });
        setNotice("Undangan berhasil dibagikan.");
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          setNotice("Menu berbagi ditutup. QR dan tautan undangan tetap tersedia di bawah.");
          return;
        }
      }
    }
    await copyInvite();
  }

  async function revoke(userId: string, displayName: string) {
    if (!window.confirm(`Cabut akses ${displayName}? Semua sesi perangkatnya akan berakhir.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await revokeEventMember(eventId, userId);
      if (!result.ok) setError(result.error.message);
      else setRefresh((value) => value + 1);
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite(invite: InviteSummary) {
    if (!window.confirm("Batalkan undangan yang masih menunggu aktivasi?")) return;
    setBusy(true);
    try {
      const result = await deleteEventInvite(eventId, invite.id);
      if (!result.ok) setError(result.error.message);
      else setRefresh((value) => value + 1);
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell variant="embedded" title="Petugas" subtitle="Kelola anggota, undangan, dan penugasan scanner">
      {error && <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} />}
      {notice && <Notice tone="success">{notice}</Notice>}

      <AssignmentSection eventId={eventId} members={data?.members ?? []} />

      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <UserPlus aria-hidden="true" className="size-4" />
          <h2 className="font-semibold">Undang anggota</h2>
        </div>
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={invite}>
          <Field label="Nama (opsional)" htmlFor="invite-name">
            <Input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </Field>
          <Field label="Peran" htmlFor="invite-role">
            <Select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
              <option value="officer">Petugas</option>
              <option value="event_admin">Admin acara</option>
            </Select>
          </Field>
          <Field label="Masa berlaku" htmlFor="invite-expiry">
            <Select id="invite-expiry" value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))}>
              <option value={24}>24 jam</option><option value={72}>3 hari</option><option value={168}>7 hari</option>
            </Select>
          </Field>
          <Button type="submit" className="sm:col-span-3" disabled={busy}>Buat tautan undangan</Button>
        </form>
        {createdInvite && (
          <div className="grid gap-4 rounded-lg bg-muted/60 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">Bagikan undangan kepada petugas</p>
                <p className="mt-1 text-muted-foreground">Tautan dan QR ini hanya tersedia saat ini, berlaku sampai {formatDateTime(createdInvite.expiresAt, "UTC")} UTC, dan hanya dapat dipakai sekali.</p>
              </div>
              <code className="block max-h-20 overflow-auto break-all rounded-md border bg-background p-2 text-xs">{window.location.origin}{createdInvite.activatePath}</code>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void shareInvite()}><Share2 className="size-4" />Bagikan tautan</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void copyInvite()}><Copy className="size-4" />Salin tautan</Button>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-3">
              <QrCode value={`${window.location.origin}${createdInvite.activatePath}`} sizeMm={38} label="QR undangan aktivasi petugas" centerLogo />
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><QrCodeIcon className="size-3.5" />QR undangan</span>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Anggota aktif</h2>
        {loading ? <LoadingState label="Memuat anggota…" /> : data?.members.length ? (
          <ul className="divide-y rounded-xl border">
            {data.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 p-3">
                <UserCog aria-hidden="true" className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.displayName}</p><p className="text-xs text-muted-foreground">{member.role === "event_admin" ? "Admin acara" : "Petugas"}</p></div>
                {session.status === "authenticated" && member.userId !== session.user.id && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void revoke(member.userId, member.displayName)}><UserMinus className="size-4" />Cabut akses</Button>
                )}
              </li>
            ))}
          </ul>
        ) : <EmptyState>Belum ada anggota acara.</EmptyState>}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Undangan</h2>
        {loading ? <LoadingState label="Memuat undangan…" /> : data?.invites.length ? (
          <ul className="divide-y rounded-xl border">
            {data.invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium">{invite.invitedName || (invite.role === "event_admin" ? "Admin acara" : "Petugas")}</p><p className="text-xs text-muted-foreground">{invite.status} · berlaku sampai {formatDateTime(invite.expiresAt, "UTC")} UTC</p></div>
                {invite.status === "pending" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void cancelInvite(invite)}>Batalkan</Button>}
              </li>
            ))}
          </ul>
        ) : <EmptyState>Belum ada undangan.</EmptyState>}
      </section>
    </AppShell>
  );
}

/**
 * Penugasan scanner (Q6 §9). The Worker is the final authority; this section
 * only narrows the UI to Aktivitas/Sesi the Petugas can actually scan.
 */
function AssignmentSection({ eventId, members }: { eventId: string; members: MemberSummary[] }) {
  const [assignments, setAssignments] = useState<StaffAssignment[] | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [statusFilter, setStatusFilter] = useState<AssignmentStatusFilter>("active");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [officerId, setOfficerId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<ActivitySession[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [manual, setManual] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<StaffAssignment | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([listEventAssignments(eventId, "all"), listActivities(eventId)])
      .then(([assignmentBody, activityBody]) => {
        if (cancelled) return;
        if (!assignmentBody.ok) {
          setError(assignmentBody.error.message);
          return;
        }
        if (!activityBody.ok) {
          setError(activityBody.error.message);
          return;
        }
        setAssignments(assignmentBody.data.assignments);
        setActivities(
          activityBody.data.activities.filter(
            (activity) => activity.status !== "archived" && activity.archivedAt === null,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setError("Tidak bisa menghubungi server");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, refresh]);

  useEffect(() => {
    if (!dialogOpen || !activityId) {
      setSessions(null);
      return;
    }

    let cancelled = false;
    setSessionsLoading(true);
    setFormError(null);

    listActivitySessions(eventId, activityId)
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          setFormError(body.error.message);
          setSessions([]);
          setSessionId("");
          return;
        }
        const list = body.data.sessions.filter((item) => item.archivedAt === null);
        setSessions(list);
        setSessionId(list[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setFormError("Tidak bisa memuat Sesi");
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dialogOpen, eventId, activityId]);

  const activeAssignments = (assignments ?? []).filter((item) => item.status === "active");
  const visibleAssignments = (assignments ?? []).filter(
    (item) => statusFilter === "all" || item.status === statusFilter,
  );
  const officers = members.filter((member) => member.role === "officer");
  const unassigned = officers.filter(
    (member) => !activeAssignments.some((item) => item.userId === member.userId),
  );

  function openCreate(presetUserId?: string) {
    setOfficerId(presetUserId ?? officers[0]?.userId ?? "");
    setActivityId(activities[0]?.id ?? "");
    setSessionId("");
    setSessions(null);
    setManual(false);
    setFormError(null);
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!officerId || !activityId) {
      setFormError("Pilih Petugas dan Aktivitas terlebih dahulu");
      return;
    }
    if (sessionsLoading) {
      setFormError("Tunggu daftar Sesi selesai dimuat");
      return;
    }

    const needsSession = (sessions?.length ?? 0) > 0;
    if (needsSession && !sessionId) {
      setFormError("Pilih Sesi untuk Aktivitas ini");
      return;
    }

    setSaving(true);
    try {
      const result = await createAssignment(eventId, {
        userId: officerId,
        activityId,
        sessionId: needsSession ? sessionId : null,
        canManualCheckIn: manual,
      });
      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }
      setDialogOpen(false);
      setRefresh((value) => value + 1);
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(false);
    }
  }

  async function toggleManual(assignment: StaffAssignment) {
    setRowBusy(assignment.id);
    setError(null);
    try {
      const result = await updateAssignmentManualFlag(eventId, assignment.id, {
        canManualCheckIn: !assignment.canManualCheckIn,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAssignments((current) =>
        current
          ? current.map((item) =>
              item.id === result.data.assignment.id ? result.data.assignment : item,
            )
          : current,
      );
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setRowBusy(null);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRowBusy(revokeTarget.id);
    setRevokeError(null);
    try {
      const result = await revokeAssignment(eventId, revokeTarget.id);
      if (!result.ok) {
        setRevokeError(result.error.message);
        return;
      }
      setRevokeTarget(null);
      setRefresh((value) => value + 1);
    } catch {
      setRevokeError("Tidak bisa menghubungi server");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <ListChecks aria-hidden="true" className="size-4" />
            Penugasan scanner
          </h2>
          <p className="text-sm text-muted-foreground">
            Tentukan Aktivitas/Sesi yang boleh dipindai tiap Petugas. Satu perangkat boleh
            dipakai bergantian, tetapi setiap Petugas wajib memakai akun sendiri.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Status" htmlFor="assignment-filter">
            <Select
              id="assignment-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as AssignmentStatusFilter)}
            >
              <option value="active">Aktif</option>
              <option value="revoked">Dicabut</option>
              <option value="all">Semua</option>
            </Select>
          </Field>
          <Button type="button" size="sm" onClick={() => openCreate()} disabled={officers.length === 0 || activities.length === 0}>
            <Plus aria-hidden="true" className="size-4" />
            Buat penugasan
          </Button>
        </div>
      </div>

      {unassigned.length > 0 && (
        <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-sm text-amber-900">
          <p className="font-medium">Petugas aktif belum punya penugasan</p>
          <p className="mt-1">
            {unassigned.map((member) => member.displayName).join(", ")} — belum bisa memindai
            sampai ditugaskan.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => openCreate(unassigned[0]?.userId)}
            disabled={activities.length === 0}
          >
            <Plus aria-hidden="true" className="size-4" />
            Buat penugasan
          </Button>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} />}

      {loading ? (
        <LoadingState label="Memuat penugasan…" />
      ) : visibleAssignments.length === 0 ? (
        <EmptyState>
          {statusFilter === "active"
            ? "Belum ada penugasan aktif. Petugas tidak bisa memindai tanpa penugasan."
            : "Tidak ada penugasan pada filter ini."}
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Petugas</TableHead>
              <TableHead>Aktivitas</TableHead>
              <TableHead>Sesi</TableHead>
              <TableHead>Manual Check-in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleAssignments.map((assignment) => (
              <TableRow key={assignment.id}>
                <TableCell className="font-medium">{assignment.userDisplayName}</TableCell>
                <TableCell>{assignment.activityName}</TableCell>
                <TableCell>{assignment.sessionName ?? "Semua sesi"}</TableCell>
                <TableCell>
                  {assignment.status === "active" ? (
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={assignment.canManualCheckIn}
                        disabled={rowBusy === assignment.id}
                        aria-label={`Manual Check-in untuk ${assignment.userDisplayName}`}
                        onChange={() => void toggleManual(assignment)}
                      />
                      <span className="text-sm">
                        {assignment.canManualCheckIn ? "Manual aktif" : "Manual mati"}
                      </span>
                    </label>
                  ) : (
                    <Badge variant="muted">Tidak berlaku</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={assignment.status === "active" ? "success" : "muted"}>
                    {assignment.status === "active" ? "Aktif" : "Dicabut"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {assignment.status === "active" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={rowBusy === assignment.id}
                      onClick={() => {
                        setRevokeError(null);
                        setRevokeTarget(assignment);
                      }}
                    >
                      Cabut
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        ariaLabel="Buat penugasan scanner"
      >
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Buat penugasan scanner</DialogTitle>
            <DialogDescription>
              Petugas hanya bisa memindai Aktivitas/Sesi yang ditugaskan. Riwayat transaksi lama
              tidak berubah.
            </DialogDescription>
          </DialogHeader>

          <Field label="Petugas" htmlFor="assignment-officer">
            <Select
              id="assignment-officer"
              value={officerId}
              onChange={(event) => setOfficerId(event.target.value)}
              autoFocus
            >
              {officers.length === 0 && <option value="">Belum ada Petugas aktif</option>}
              {officers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Aktivitas" htmlFor="assignment-activity">
            <Select
              id="assignment-activity"
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
            >
              {activities.length === 0 && <option value="">Belum ada Aktivitas aktif</option>}
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Sesi" htmlFor="assignment-session">
            <Select
              id="assignment-session"
              value={sessionId}
              disabled={sessionsLoading || (sessions?.length ?? 0) === 0}
              onChange={(event) => setSessionId(event.target.value)}
            >
              {sessionsLoading && <option value="">Memuat Sesi…</option>}
              {!sessionsLoading && (sessions?.length ?? 0) === 0 && (
                <option value="">Aktivitas ini tanpa Sesi</option>
              )}
              {sessions?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={manual}
              onChange={(event) => setManual(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Manual Check-in</span>
              <span className="block text-xs text-muted-foreground">
                Hanya membuka Manual Entry; entitlement tetap terpisah.
              </span>
            </span>
          </label>

          {formError && (
            <p role="alert" className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button type="submit" disabled={saving || sessionsLoading || officers.length === 0}>
              Simpan penugasan
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        ariaLabel="Cabut penugasan"
      >
        <DialogHeader>
          <DialogTitle>Cabut penugasan?</DialogTitle>
          <DialogDescription>
            {revokeTarget?.userDisplayName} tidak bisa memindai {revokeTarget?.activityName}
            {revokeTarget?.sessionName ? ` · ${revokeTarget.sessionName}` : ""} lagi. Riwayat
            transaksi tetap tersimpan.
          </DialogDescription>
        </DialogHeader>

        {revokeError && (
          <p role="alert" className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700">
            {revokeError}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRevokeTarget(null)}
            disabled={rowBusy !== null}
          >
            Batal
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void confirmRevoke()}
            disabled={rowBusy !== null}
          >
            Cabut penugasan
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}
