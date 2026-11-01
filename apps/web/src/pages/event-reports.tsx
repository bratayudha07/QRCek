import type { EventDashboardPayload, SyncStatusPayload } from "@absensi/shared";
import { Activity, Download, RefreshCw, Save, Settings2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  downloadAttendanceCsv,
  fullSync,
  getEventDashboard,
  getSyncConfig,
  retrySyncItem,
  runSync,
  saveSyncConfig,
  testSync,
} from "@/lib/attendance";
import { formatCount, formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

const STATUS_LABELS = { present: "Hadir", late: "Terlambat", absent: "Tidak hadir", excused: "Izin" } as const;

export function EventReportsPage({ eventId }: { eventId: string }) {
  const session = useSession();
  const canConfigureSync = session.status === "authenticated" && (
    session.user.role === "superadmin" ||
    session.memberships.some((membership) => membership.eventId === eventId && membership.role === "event_admin")
  );
  const [dashboard, setDashboard] = useState<EventDashboardPayload | null>(null);
  const [sync, setSync] = useState<SyncStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetTab, setSheetTab] = useState("Kehadiran");
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getEventDashboard(eventId), canConfigureSync ? getSyncConfig(eventId) : Promise.resolve(null)])
      .then(([report, syncBody]) => {
        if (cancelled) return;
        if (report.ok) setDashboard(report.data);
        else setError(report.error.message);
        if (syncBody?.ok) {
          setSync(syncBody.data);
          setSpreadsheetId(syncBody.data.config.spreadsheetId ?? "");
          setSheetTab(syncBody.data.config.sheetTab ?? "Kehadiran");
          setSyncEnabled(syncBody.data.config.syncEnabled);
        } else if (syncBody && !syncBody.ok) setSyncError(syncBody.error.message);
      })
      .catch(() => { if (!cancelled) setError("Tidak bisa menghubungi server"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, refresh, canConfigureSync]);

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setSyncError(null); setNotice(null);
    try {
      const body = await saveSyncConfig(eventId, { spreadsheetId, sheetTab, syncEnabled });
      if (!body.ok) setSyncError(body.error.message);
      else { setNotice("Pengaturan sinkronisasi disimpan."); setRefresh((value) => value + 1); }
    } catch { setSyncError("Tidak bisa menghubungi server"); }
    finally { setBusy(false); }
  }

  async function testConnection() {
    if (!window.confirm("Uji akses akan menulis satu sel metadata ke spreadsheet. Lanjutkan?")) return;
    setBusy(true); setSyncError(null); setNotice(null);
    try {
      const body = await testSync(eventId);
      if (!body.ok) setSyncError(body.error.message);
      else setNotice(`Akses berhasil: ${body.data.spreadsheetTitle} · tab ${body.data.sheetTab}`);
    } catch { setSyncError("Tidak bisa menghubungi server"); }
    finally { setBusy(false); }
  }

  async function performSync(action: "run" | "full") {
    if (action === "full" && !window.confirm("Masukkan ulang seluruh data peserta acara ke antrean sinkronisasi?")) return;
    setBusy(true); setSyncError(null); setNotice(null);
    try {
      if (action === "full") {
        const body = await fullSync(eventId);
        if (!body.ok) setSyncError(body.error.message);
        else { setNotice(`${body.data.enqueued} baris dimasukkan ke antrean.`); setRefresh((value) => value + 1); }
      } else {
        const body = await runSync(eventId, 20);
        if (!body.ok) setSyncError(body.error.message);
        else { setNotice(`${body.data.succeeded} berhasil, ${body.data.failed} gagal.`); setRefresh((value) => value + 1); }
      }
    } catch { setSyncError("Tidak bisa menghubungi server"); }
    finally { setBusy(false); }
  }

  async function exportReport() {
    setBusy(true); setError(null);
    try {
      const result = await downloadAttendanceCsv(eventId);
      if (!result.ok) setError(result.message);
    } catch { setError("Tidak bisa mengunduh laporan"); }
    finally { setBusy(false); }
  }

  async function retryItem(id: string) {
    setBusy(true); setSyncError(null);
    try {
      const body = await retrySyncItem(eventId, id);
      if (!body.ok) setSyncError(body.error.message);
      else setRefresh((value) => value + 1);
    } catch { setSyncError("Tidak bisa menghubungi server"); }
    finally { setBusy(false); }
  }

  return (
    <AppShell title="Laporan" subtitle="Rekap kehadiran dan status sinkronisasi">
      {error && <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} />}
      {notice && <Notice tone="success">{notice}</Notice>}
      {loading && <LoadingState label="Memuat laporan…" />}
      {dashboard && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Peserta aktif" value={formatCount(dashboard.activeParticipants)} />
            <Metric label="Sudah absen" value={formatCount(dashboard.presentCount)} />
            <Metric label="Belum tercatat" value={formatCount(dashboard.notPresentCount)} />
            <Metric label="Persentase" value={`${dashboard.attendancePercentage}%`} />
          </section>
          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center gap-2"><Activity className="size-4" /><h2 className="font-semibold">Rincian status</h2></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(dashboard.byStatus).map(([key, value]) => <div key={key} className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{STATUS_LABELS[key as keyof typeof STATUS_LABELS]}</p><p className="text-lg font-semibold">{formatCount(value)}</p></div>)}</div>
          </section>
          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Kehadiran terbaru</h2><Button variant="outline" disabled={busy} onClick={() => void exportReport()}><Download className="size-4" />Unduh CSV kehadiran</Button></div>
            {dashboard.recent.length === 0 ? <EmptyState>Belum ada kehadiran tercatat.</EmptyState> : <ul className="divide-y">{dashboard.recent.map((item) => <li key={`${item.participantId}-${item.checkedInAt}`} className="flex items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{item.participantName}{item.category ? ` · ${item.category}` : ""}</span><span className="text-xs text-muted-foreground">{formatDateTime(item.checkedInAt, "Asia/Jakarta")}</span></li>)}</ul>}
          </section>
        </>
      )}

      {canConfigureSync && <section className="space-y-4 rounded-xl border p-4">
        <div className="flex items-center gap-2"><Settings2 className="size-4" /><h2 className="font-semibold">Google Sheets</h2></div>
        {syncError && <ErrorState message={syncError} />}
        <p className="text-sm text-muted-foreground">D1 tetap menjadi sumber data utama. Bagikan spreadsheet kepada service account sebagai Editor agar sinkronisasi dapat menulis.</p>
        {sync?.config.serviceAccountEmail && <Notice>Service account: <span className="font-mono">{sync.config.serviceAccountEmail}</span></Notice>}
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void saveConfig(event)}>
          <Field label="ID spreadsheet" htmlFor="sheet-id" hint="Ambil bagian ID dari URL Google Sheets."><Input id="sheet-id" value={spreadsheetId} onChange={(event) => setSpreadsheetId(event.target.value)} minLength={10} maxLength={200} required /></Field>
          <Field label="Nama tab" htmlFor="sheet-tab"><Input id="sheet-tab" value={sheetTab} onChange={(event) => setSheetTab(event.target.value)} maxLength={100} required /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={syncEnabled} onChange={(event) => setSyncEnabled(event.target.checked)} />Aktifkan sinkronisasi otomatis</label>
          <div className="flex flex-wrap gap-2 sm:col-span-2"><Button disabled={busy}><Save className="size-4" />Simpan pengaturan</Button><Button type="button" variant="outline" disabled={busy || !sync?.config.configured} onClick={() => void testConnection()}>Uji akses</Button><Button type="button" variant="outline" disabled={busy || !sync?.config.configured} onClick={() => void performSync("run")}><RefreshCw className="size-4" />Jalankan antrean</Button><Button type="button" variant="outline" disabled={busy || !sync?.config.configured} onClick={() => void performSync("full")}>Sinkronisasi penuh</Button></div>
        </form>
        {sync?.config.lastError && <Notice tone="warning">Kesalahan terakhir: {sync.config.lastError}</Notice>}
        {sync && <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Object.entries(sync.counts).map(([key, count]) => <div key={key} className="rounded-lg bg-muted/50 p-2 text-center"><p className="text-xs text-muted-foreground">{key}</p><p className="font-semibold">{count}</p></div>)}</div>}
        {sync && sync.items.length > 0 && <ul className="divide-y rounded-lg border">{sync.items.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-2 p-3 text-sm"><span className="min-w-0 flex-1">{item.participantName} · {item.kind} · {item.status}{item.lastError ? <span className="block text-xs text-red-700">{item.lastError}</span> : null}</span>{(item.status === "failed" || item.status === "dead") && <Button size="sm" variant="outline" disabled={busy} onClick={() => void retryItem(item.id)}>Ulangi</Button>}</li>)}</ul>}
      </section>}
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}
