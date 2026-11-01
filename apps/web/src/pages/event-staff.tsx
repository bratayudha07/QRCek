import type { InviteCreatedPayload, InviteSummary, MemberSummary } from "@absensi/shared";
import { Copy, UserCog, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { createEventInvite, deleteEventInvite, listEventInvites, listEventMembers, revokeEventMember } from "@/lib/event-admin";
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
      setNotice(`Salin tautan ini secara manual: ${url}`);
    }
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
    <AppShell title="Petugas" subtitle="Kelola anggota dan undangan acara">
      {error && <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} />}
      {notice && <Notice tone="success">{notice}</Notice>}
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
          <Button className="sm:col-span-3" disabled={busy}>Buat tautan undangan</Button>
        </form>
        {createdInvite && (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <p className="font-medium">Kirim tautan ini kepada penerima. Tautan aktivasi hanya ditampilkan sekali.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all">{window.location.origin}{createdInvite.activatePath}</code>
              <Button type="button" variant="outline" size="sm" onClick={copyInvite}><Copy className="size-4" />Salin</Button>
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
