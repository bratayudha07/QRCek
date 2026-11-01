import type { GlobalDashboardPayload } from "@absensi/shared";
import { CalendarDays, ClipboardCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { getGlobalDashboard } from "@/lib/attendance";
import { formatCount, formatDateTime } from "@/lib/format";
import { eventOverviewPath, paths } from "@/lib/router";
import { useSession } from "@/lib/session";

export function DashboardPage() {
  const session = useSession();
  const [data, setData] = useState<GlobalDashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGlobalDashboard().then((body) => {
      if (cancelled) return;
      if (body.ok) { setData(body.data); setError(null); }
      else setError(body.error.message);
    }).catch(() => { if (!cancelled) setError("Tidak bisa menghubungi server"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  return (
    <AppShell title="Dashboard" subtitle={session.status === "authenticated" ? `Selamat datang, ${session.user.displayName}` : "Ringkasan acara"}>
      {session.status === "anonymous" && <Notice tone="warning">Sesi tidak valid atau sudah berakhir. <a className="underline" href={paths.login}>Masuk kembali dengan kode pemulihan</a>.</Notice>}
      {error && <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} />}
      {loading && <LoadingState label="Memuat ringkasan…" />}
      {data && <>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Acara" value={formatCount(data.totals.events)} />
          <Metric label="Peserta" value={formatCount(data.totals.participants)} />
          <Metric label="Sudah absen" value={formatCount(data.totals.present)} />
          <Metric label="Persentase hadir" value={`${data.totals.attendancePercentage}%`} />
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold">Acara yang dapat diakses</h2>
          {data.events.length === 0 ? <EmptyState>Belum ada acara. <AppLink href={paths.events} className="underline">Buka daftar acara</AppLink> untuk membuat acara.</EmptyState> : <ul className="divide-y rounded-xl border">{data.events.map((event) => <li key={event.id}><AppLink href={eventOverviewPath(event.id)} className="flex flex-wrap items-center gap-3 p-4 hover:bg-muted/40"><CalendarDays aria-hidden="true" className="size-5 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{event.name}</span><span className="text-xs text-muted-foreground">{event.status} · {event.accessRole === "event_admin" ? "Admin acara" : event.accessRole === "officer" ? "Petugas" : "Superadmin"}</span>{event.startsAt !== null && <span className="block text-xs text-muted-foreground">{formatDateTime(event.startsAt, "Asia/Jakarta")}</span>}</span><span className="inline-flex items-center gap-1 text-sm"><ClipboardCheck className="size-4" />{formatCount(event.presentCount)} / {formatCount(event.participantCount)} ({event.attendancePercentage}%)</span></AppLink></li>)}</ul>}
        </section>
      </>}
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}
