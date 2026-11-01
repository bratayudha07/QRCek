import type { AttendanceRecord } from "@absensi/shared";
import { History, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { QrScanner } from "@/components/qr-scanner";
import { ScanToast, type ScanNotification } from "@/components/scan-toast";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { listStaffAttendance, scanQr } from "@/lib/attendance";
import { formatDateTime } from "@/lib/format";
import { SCAN_RESULT_COPY } from "@/lib/scanner";
import { eventOverviewPath, paths } from "@/lib/router";
import { useSession } from "@/lib/session";

/**
 * Staff destinations. Beranda lists the events the officer is assigned to so
 * the move to a staff-only navigation does not hide existing event access; the
 * scanner and history screens are explicit placeholders for the scan stage.
 */
export function StaffHomePage() {
  const session = useSession();

  return (
    <AppShell
      title="Beranda"
      subtitle={
        session.status === "authenticated"
          ? `Halo, ${session.user.displayName}`
          : "Ruang kerja petugas"
      }
    >
      {session.status === "loading" && <LoadingState label="Memeriksa sesi…" />}

      {session.status === "error" && <ErrorState message={session.message} />}

      {session.status === "anonymous" && (
        <Notice tone="warning">
          Anda belum masuk.{" "}
          <a className="underline underline-offset-4" href={paths.login}>
            Masuk dengan kode pemulihan
          </a>{" "}
          untuk mulai memindai.
        </Notice>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <AppLink
          href={paths.staffScan}
          className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 transition-colors duration-150 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ScanLine aria-hidden="true" className="size-5" />
          </span>
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold">Scan QR</span>
            <span className="block text-xs text-muted-foreground">
              Pindai kartu peserta untuk mencatat kehadiran.
            </span>
          </span>
        </AppLink>

        <AppLink
          href={paths.staffHistory}
          className="flex items-start gap-3 rounded-lg border p-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <History aria-hidden="true" className="size-5" />
          </span>
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold">Riwayat</span>
            <span className="block text-xs text-muted-foreground">
              Hasil pemindaian terakhir Anda.
            </span>
          </span>
        </AppLink>
      </section>

      {session.status === "authenticated" && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Acara Anda</h2>

          {session.memberships.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Belum ada acara yang ditugaskan kepada Anda.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {session.memberships.map((membership) => (
                <li key={membership.eventId}>
                  <AppLink
                    href={eventOverviewPath(membership.eventId)}
                    className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {membership.eventName}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {membership.role === "event_admin" ? "Admin acara" : "Petugas"}
                      </span>
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </AppShell>
  );
}

export function StaffScanPage() {
  const session = useSession();
  const memberships = session.status === "authenticated" ? session.memberships : [];
  const [eventId, setEventId] = useState(memberships[0]?.eventId ?? "");
  const [scanPending, setScanPending] = useState(false);
  const [notification, setNotification] = useState<ScanNotification | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!eventId && memberships[0]) setEventId(memberships[0].eventId);
  }, [eventId, memberships]);

  async function handleDetected(qr: string) {
    if (inFlight.current || !eventId) return;
    inFlight.current = true;
    setScanPending(true);
    try {
      const response = await scanQr(eventId, qr);
      if (response.ok) {
        const copy = SCAN_RESULT_COPY[response.data.result];
        setNotification({
          tone: copy.tone,
          title: response.data.result === "present" ? "Berhasil absen" : copy.title,
          description: copy.description,
          ...(response.data.participant ? { participantName: response.data.participant.fullName } : {}),
        });
      } else {
        setNotification({ tone: "error", title: "Scan gagal", description: response.error.message });
      }
    } catch {
      setNotification({ tone: "error", title: "Koneksi bermasalah", description: "Tidak bisa menghubungi server. Periksa jaringan." });
    } finally {
      inFlight.current = false;
      setScanPending(false);
    }
  }

  return (
    <AppShell title="Scan QR" subtitle="Pindai kartu peserta untuk mencatat kehadiran">
      {session.status === "loading" && <LoadingState label="Memeriksa sesi…" />}
      {session.status === "error" && <ErrorState message={session.message} />}
      {session.status === "anonymous" && <Notice tone="warning">Sesi sudah berakhir. <a className="underline" href={paths.login}>Masuk kembali dengan kode pemulihan</a>.</Notice>}
      {session.status === "authenticated" && memberships.length === 0 && <EmptyState>Akun ini belum ditugaskan ke acara. Minta admin acara mengirim undangan.</EmptyState>}
      {memberships.length > 0 && (
        <>
          <label className="block space-y-1 text-sm font-medium" htmlFor="scan-event">Acara</label>
          <select id="scan-event" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={eventId} onChange={(event) => { setEventId(event.target.value); setNotification(null); }}>
            {memberships.map((membership) => <option key={membership.eventId} value={membership.eventId}>{membership.eventName}</option>)}
          </select>
          <QrScanner paused={scanPending} onDetected={(qr) => void handleDetected(qr)} />
          <ScanToast notification={notification} onDismiss={() => setNotification(null)} />
        </>
      )}
    </AppShell>
  );
}

export function StaffHistoryPage() {
  const [items, setItems] = useState<AttendanceRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listStaffAttendance({ limit: 25 })
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) setError(body.error.message);
        else { setItems(body.data.items); setCursor(body.data.nextCursor); }
      })
      .catch(() => { if (!cancelled) setError("Tidak bisa menghubungi server"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const body = await listStaffAttendance({ limit: 25, cursor });
      if (!body.ok) setError(body.error.message);
      else { setItems((current) => [...current, ...body.data.items]); setCursor(body.data.nextCursor); }
    } catch { setError("Tidak bisa menghubungi server"); }
    finally { setLoading(false); }
  }

  return (
    <AppShell title="Riwayat" subtitle="Absensi yang Anda catat">
      {error && <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} />}
      {loading && <LoadingState label="Memuat riwayat…" />}
      {!loading && items.length === 0 && !error && <EmptyState>Belum ada hasil scan yang tercatat.</EmptyState>}
      {items.length > 0 && <ul className="divide-y rounded-xl border">{items.map((item) => <li key={item.id} className="p-3"><p className="text-sm font-medium">{item.participantName}</p><p className="text-xs text-muted-foreground">{item.eventName} · {item.status} · {formatDateTime(item.checkedInAt, "Asia/Jakarta")}</p></li>)}</ul>}
      {cursor && <Button variant="outline" disabled={loading} onClick={() => void loadMore()}>Muat lagi</Button>}
      {refresh > 0 && <span className="sr-only">Riwayat diperbarui</span>}
    </AppShell>
  );
}
