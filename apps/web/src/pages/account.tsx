import type { Role, SessionSummary } from "@absensi/shared";
import { ChevronRight, KeyRound, LogOut, MonitorSmartphone } from "lucide-react";
import { useEffect, useState } from "react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { listSessions, logoutSession, revokeSession, rotateRecoveryCode } from "@/lib/auth";
import { eventOverviewPath, navigate, paths } from "@/lib/router";
import { useSession } from "@/lib/session";

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Superadmin",
  event_admin: "Admin acara",
  officer: "Petugas",
};

export function AccountPage({
  title = "Akun",
  subtitle = "Sesi dan keanggotaan acara",
}: {
  title?: string;
  subtitle?: string;
}) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    let cancelled = false;
    listSessions().then((body) => {
      if (cancelled) return;
      if (body.ok) setSessions(body.data.sessions);
      else setError(body.error.message);
    }).catch(() => { if (!cancelled) setError("Tidak bisa memuat sesi perangkat"); });
    return () => { cancelled = true; };
  }, [session.status]);

  async function logout() {
    setBusy(true);
    setError(null);

    try {
      await logoutSession();
      navigate(paths.login);
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOtherSession(item: SessionSummary) {
    if (!window.confirm(`Cabut sesi ${item.label || "perangkat tanpa nama"}?`)) return;
    setBusy(true); setError(null);
    try {
      const body = await revokeSession(item.id);
      if (!body.ok) setError(body.error.message);
      else setSessions((current) => current.filter((row) => row.id !== item.id));
    } catch { setError("Tidak bisa menghubungi server"); }
    finally { setBusy(false); }
  }

  async function rotateCode() {
    if (!window.confirm("Kode pemulihan lama langsung tidak berlaku. Simpan kode baru setelah dibuat. Lanjutkan?")) return;
    setBusy(true); setError(null);
    try {
      const body = await rotateRecoveryCode();
      if (!body.ok) setError(body.error.message);
      else setRecoveryCode(body.data.recoveryCode);
    } catch { setError("Tidak bisa menghubungi server"); }
    finally { setBusy(false); }
  }

  return (
    <AppShell title={title} subtitle={subtitle}>
      {session.status === "loading" && <LoadingState label="Memeriksa sesi…" />}

      {session.status === "error" && <ErrorState message={session.message} />}

      {session.status === "anonymous" && (
        <Notice tone="warning">
          Anda belum masuk.{" "}
          <AppLink className="underline underline-offset-4" href="/masuk">
            Masuk dengan kode pemulihan
          </AppLink>
          .
        </Notice>
      )}

      {session.status === "authenticated" && (
        <>
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Profil</h2>
            <p className="mt-2 text-sm">{session.user.displayName}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABEL[session.user.role]}</p>

            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={logout}
              disabled={busy}
            >
              <LogOut aria-hidden="true" className="size-4" />
              Keluar
            </Button>

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Keanggotaan acara</h2>

            {session.memberships.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Belum ada keanggotaan acara. Superadmin dapat mengakses semua acara tanpa
                keanggotaan.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {session.memberships.map((membership) => (
                  <li key={membership.eventId}>
                    <AppLink
                      href={eventOverviewPath(membership.eventId)}
                      className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{membership.eventName}</p>
                        <p className="text-xs text-muted-foreground">
                          {membership.role === "event_admin" ? "Admin acara" : "Petugas"}
                        </p>
                      </div>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2"><MonitorSmartphone className="size-4" /><h2 className="text-sm font-semibold">Sesi perangkat</h2></div>
            {sessions.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada sesi aktif yang terdaftar.</p> : <ul className="divide-y">{sessions.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-2 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.label || "Perangkat tanpa nama"}{item.current ? " · Perangkat ini" : ""}</p><p className="text-xs text-muted-foreground">Terakhir aktif {new Date(item.lastSeenAt).toLocaleString("id-ID")}</p></div>{!item.current && <Button variant="outline" size="sm" disabled={busy} onClick={() => void revokeOtherSession(item)}>Cabut sesi</Button>}</li>)}</ul>}
          </section>

          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2"><KeyRound className="size-4" /><h2 className="text-sm font-semibold">Kode pemulihan</h2></div>
            <p className="text-sm text-muted-foreground">Kode baru menggantikan kode lama. Simpan di tempat aman; kode hanya ditampilkan satu kali.</p>
            {recoveryCode ? <div className="rounded-lg bg-muted p-3"><p className="mb-1 text-xs text-muted-foreground">Kode pemulihan baru</p><code className="select-all font-mono text-lg tracking-wider">{recoveryCode}</code></div> : <Button variant="outline" disabled={busy} onClick={() => void rotateCode()}>Buat kode baru</Button>}
          </section>
        </>
      )}
    </AppShell>
  );
}
