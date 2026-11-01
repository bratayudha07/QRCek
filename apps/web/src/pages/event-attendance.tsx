import type { AttendanceRecord, AttendanceStatus } from "@absensi/shared";
import { Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { QrScanner } from "@/components/qr-scanner";
import { ScanToast, type ScanNotification } from "@/components/scan-toast";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { correctAttendance, listAttendance, scanQr } from "@/lib/attendance";
import { getEvent } from "@/lib/events";
import { SCAN_RESULT_COPY } from "@/lib/scanner";
import { useSession } from "@/lib/session";

const STATUSES: AttendanceStatus[] = ["present", "late", "absent", "excused"];
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: "Hadir", late: "Terlambat", absent: "Tidak hadir", excused: "Izin" };

export function EventAttendancePage({ eventId }: { eventId: string }) {
  const session = useSession();
  const [rows, setRows] = useState<AttendanceRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState<AttendanceStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [scanPending, setScanPending] = useState(false);
  const [scanNotification, setScanNotification] = useState<ScanNotification | null>(null);
  const scanning = useRef(false);
  const [selected, setSelected] = useState<AttendanceRecord | null>(null);
  const [correctionStatus, setCorrectionStatus] = useState<AttendanceStatus>("present");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canCorrect, setCanCorrect] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEvent(eventId).then((body) => {
      if (cancelled) return;
      if (body.ok) setCanCorrect(body.data.event.accessRole === "superadmin" || body.data.event.accessRole === "event_admin");
      else setError(body.error.message);
    }).catch(() => { if (!cancelled) setError("Tidak bisa memuat acara"); });
    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAttendance(eventId, { query: appliedQuery, status, limit: 25 })
      .then((body) => {
        if (cancelled) return;
        if (body.ok) { setRows(body.data.items); setCursor(body.data.nextCursor); }
        else setError(body.error.message);
      })
      .catch(() => { if (!cancelled) setError("Tidak bisa menghubungi server"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, appliedQuery, status, refresh]);

  async function onDetected(qr: string) {
    if (scanning.current) return;
    scanning.current = true;
    setScanPending(true);
    try {
      const body = await scanQr(eventId, qr);
      if (body.ok) {
        const copy = SCAN_RESULT_COPY[body.data.result];
        setScanNotification({
          tone: copy.tone,
          title: body.data.result === "present"
            ? "Berhasil absen"
            : body.data.result === "duplicate"
              ? "Peserta sudah diabsen"
              : copy.title,
          description: body.data.result === "duplicate"
            ? "Absensi peserta ini sudah tercatat sebelumnya."
            : copy.description,
          ...(body.data.participant ? { participantName: body.data.participant.fullName } : {}),
        });
        setRefresh((value) => value + 1);
      } else {
        setScanNotification({ tone: "error", title: "Scan gagal", description: body.error.message });
      }
    } catch {
      setScanNotification({ tone: "error", title: "Koneksi bermasalah", description: "Tidak bisa menghubungi server. Periksa jaringan." });
    } finally {
      scanning.current = false;
      setScanPending(false);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const body = await listAttendance(eventId, { query: appliedQuery, status, limit: 25, cursor });
      if (body.ok) { setRows((current) => [...current, ...body.data.items]); setCursor(body.data.nextCursor); }
      else setError(body.error.message);
    } catch { setError("Tidak bisa menghubungi server"); }
    finally { setLoading(false); }
  }

  async function saveCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const body = await correctAttendance(eventId, selected.id, {
        status: correctionStatus,
        reason,
        expectedUpdatedAt: selected.updatedAt,
      });
      if (!body.ok) { setError(body.error.message); return; }
      setSelected(null);
      setReason("");
      setNotice("Koreksi tersimpan dan tercatat di audit.");
      setRefresh((value) => value + 1);
    } catch { setError("Tidak bisa menghubungi server"); }
    finally { setSaving(false); }
  }

  return (
    <AppShell title="Absensi" subtitle="Pindai QR, lihat kehadiran, dan koreksi catatan">
      {error && <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} />}
      {notice && <Notice tone="success">{notice}</Notice>}
      {session.status === "anonymous" && <Notice tone="warning">Sesi berakhir. <a className="underline" href="/masuk">Masuk kembali</a>.</Notice>}
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-semibold">Pemindai QR</h2>
        <QrScanner paused={scanPending} onDetected={(qr) => void onDetected(qr)} />
        <ScanToast notification={scanNotification} onDismiss={() => setScanNotification(null)} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Daftar kehadiran</h2>
          <div className="flex gap-2"><Input aria-label="Cari peserta" placeholder="Cari nama/kategori" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setAppliedQuery(query.trim()); }} /><Button variant="outline" onClick={() => setAppliedQuery(query.trim())}><Search className="size-4" />Cari</Button></div>
          <Select aria-label="Filter status" className="w-auto" value={status} onChange={(event) => setStatus(event.target.value as AttendanceStatus | "all")}><option value="all">Semua status</option>{STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}</Select>
        </div>
        {loading && <LoadingState label="Memuat kehadiran…" />}
        {!loading && rows.length === 0 && <EmptyState>Belum ada catatan kehadiran untuk filter ini.</EmptyState>}
        {rows.length > 0 && <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="p-3">Peserta</th><th className="p-3">Status</th><th className="p-3">Waktu</th><th className="p-3">Metode</th><th className="p-3">Petugas</th>{canCorrect && <th className="p-3">Aksi</th>}</tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="p-3"><p className="font-medium">{row.participantName}</p><p className="text-xs text-muted-foreground">{row.participantExternalRef || row.category || "—"}</p></td><td className="p-3">{STATUS_LABEL[row.status]}</td><td className="p-3">{new Date(row.checkedInAt).toLocaleString("id-ID")}</td><td className="p-3">{row.method}</td><td className="p-3">{row.recordedByName || "—"}</td>{canCorrect && <td className="p-3"><Button variant="outline" size="sm" onClick={() => { setSelected(row); setCorrectionStatus(row.status); }}>Koreksi</Button></td>}</tr>)}</tbody></table></div>}
        {cursor && <Button variant="outline" disabled={loading} onClick={() => void loadMore()}>Muat lagi</Button>}
      </section>

      {selected && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><form className="w-full max-w-md space-y-4 rounded-xl bg-background p-5 shadow-xl" onSubmit={(event) => void saveCorrection(event)}><div><h2 className="font-semibold">Koreksi kehadiran</h2><p className="text-sm text-muted-foreground">{selected.participantName} · nilai lama: {STATUS_LABEL[selected.status]}</p></div><label className="block space-y-1 text-sm">Status baru<Select value={correctionStatus} onChange={(event) => setCorrectionStatus(event.target.value as AttendanceStatus)}>{STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}</Select></label><label className="block space-y-1 text-sm">Alasan (min. 10 karakter)<textarea className="min-h-24 w-full rounded-md border bg-background p-3" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} required /></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSelected(null)}>Batal</Button><Button type="submit" disabled={saving || reason.trim().length < 10}>Simpan koreksi</Button></div></form></div>}
    </AppShell>
  );
}
