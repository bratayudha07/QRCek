import {
  staffContextReadiness,
  type AttendanceRecord,
  type StaffContext,
} from "@absensi/shared";
import {
  History,
  ScanLine,
  SwitchCamera,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { QrScanner, type CameraFacing } from "@/components/qr-scanner";
import { ScanFeedback } from "@/components/scan-feedback";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import { listMyStaffContexts } from "@/lib/assignments";
import { listStaffAttendance, scanQr } from "@/lib/attendance";
import { formatDateTime } from "@/lib/format";
import {
  isScannerMuted,
  playScanTone,
  setScannerMuted,
  unlockScanAudio,
} from "@/lib/scan-audio";
import {
  INITIAL_SCANNER_STATE,
  classifyScanFailure,
  classifyScanResponse,
  resolveDeepLinkContext,
  scannerIsLocked,
  scannerReducer,
  staffContextKey,
  staffContextLabel,
  type ScanFeedback as ScanFeedbackModel,
} from "@/lib/scanner";
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
          <AppLink className="underline underline-offset-4" href={paths.login}>
            Masuk dengan kode pemulihan
          </AppLink>{" "}
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
  const [contexts, setContexts] = useState<StaffContext[] | null>(null);
  const [contextsError, setContextsError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deepLinkRejected, setDeepLinkRejected] = useState(false);
  const [blocked, setBlocked] = useState<"assignment" | "session" | null>(null);
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [muted, setMuted] = useState(() => isScannerMuted());
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [scanner, dispatch] = useReducer(scannerReducer, INITIAL_SCANNER_STATE);

  const inFlight = useRef(false);
  const phaseRef = useRef(scanner.phase);
  const deepLinkHandled = useRef(false);

  phaseRef.current = scanner.phase;

  useEffect(() => {
    if (session.status !== "authenticated") {
      if (session.status === "anonymous") {
        setContexts([]);
        setSelectedKey(null);
      }
      return;
    }

    let cancelled = false;
    setContextsError(null);

    listMyStaffContexts()
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          setContextsError(body.error.message);
          return;
        }

        const list = body.data.contexts;
        setContexts(list);

        if (!deepLinkHandled.current) {
          deepLinkHandled.current = true;
          const match = resolveDeepLinkContext(list, new URLSearchParams(window.location.search));
          if (match.rejected) {
            setDeepLinkRejected(true);
            setSelectedKey(null);
            return;
          }
          if (match.context) {
            setSelectedKey(staffContextKey(match.context));
            return;
          }
        }

        setSelectedKey((current) => {
          if (current && list.some((context) => staffContextKey(context) === current)) {
            return current;
          }
          const next = list.find((context) => staffContextReadiness(context).ready) ?? list[0];
          return next ? staffContextKey(next) : null;
        });
      })
      .catch(() => {
        if (!cancelled) setContextsError("Tidak bisa menghubungi server");
      });

    return () => {
      cancelled = true;
    };
  }, [session.status, refreshToken]);

  // A new context never inherits a result from the previous one (FR-191).
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [selectedKey]);

  // Browsers only report reachability; a failed request is the real signal.
  useEffect(() => {
    function handleOffline() {
      setOnline(false);
      const feedback =
        phaseRef.current === "processing"
          ? classifyScanFailure(new Error("Koneksi terputus"))
          : undefined;
      dispatch({
        type: "network_offline",
        at: Date.now(),
        ...(feedback ? { feedback } : {}),
      });
    }

    function handleOnline() {
      setOnline(true);
      dispatch({ type: "network_online", at: Date.now() });
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // Feedback never needs a confirmation click: the phase reopens on its own.
  useEffect(() => {
    if (scanner.phase !== "feedback" || scanner.lockedUntil === null) return;

    const remaining = Math.max(0, scanner.lockedUntil - Date.now());
    const timer = window.setTimeout(() => {
      dispatch({ type: "feedback_elapsed", at: Date.now() });
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [scanner.phase, scanner.lockedUntil]);

  const selected =
    contexts?.find((context) => staffContextKey(context) === selectedKey) ?? null;
  const readiness = selected ? staffContextReadiness(selected) : null;
  const locked = scannerIsLocked(scanner);

  const themes = useMemo(() => {
    const groups = new Map<
      string,
      { themeId: string; themeName: string; contexts: StaffContext[] }
    >();

    for (const context of contexts ?? []) {
      const group = groups.get(context.themeId) ?? {
        themeId: context.themeId,
        themeName: context.themeName,
        contexts: [],
      };
      group.contexts.push(context);
      groups.set(context.themeId, group);
    }

    return [...groups.values()];
  }, [contexts]);

  const themeContexts = selected
    ? (themes.find((theme) => theme.themeId === selected.themeId)?.contexts ?? [])
    : [];

  function chooseContext(contextKey: string) {
    if (locked) return;
    setSelectedKey(contextKey);
    setPickerOpen(false);
    setDeepLinkRejected(false);
    setBlocked(null);
    dispatch({ type: "context_changed" });
    setRefreshToken((value) => value + 1);
  }

  function reloadContexts() {
    setBlocked(null);
    dispatch({ type: "reset" });
    setRefreshToken((value) => value + 1);
  }

  function applyFeedback(feedback: ScanFeedbackModel) {
    playScanTone(feedback.tone);
    if (feedback.kind === "assignment") setBlocked("assignment");
    if (feedback.kind === "session") setBlocked("session");
    dispatch({ type: "resolved", at: Date.now(), feedback });
  }

  async function handleDetected(qr: string) {
    if (
      inFlight.current ||
      !selected ||
      !readiness?.ready ||
      blocked ||
      !online ||
      scanner.phase !== "standby"
    ) {
      return;
    }

    inFlight.current = true;
    dispatch({ type: "detected", at: Date.now() });

    try {
      const response = await scanQr(selected.themeId, qr, {
        activityId: selected.activityId,
        ...(selected.sessionId ? { sessionId: selected.sessionId } : {}),
      });
      applyFeedback(classifyScanResponse(response));
    } catch (error) {
      applyFeedback(classifyScanFailure(error));
    } finally {
      inFlight.current = false;
    }
  }

  function toggleMute() {
    unlockScanAudio();
    const next = !muted;
    setMuted(next);
    setScannerMuted(next);
  }

  const cameraReady =
    selected !== null && readiness?.ready === true && blocked === null && contextsError === null;
  const showPicker = pickerOpen || selected === null;

  return (
    <AppShell
      title="Scan QR"
      subtitle={
        session.status === "authenticated"
          ? `Masuk sebagai ${session.user.displayName} · gunakan akun sendiri`
          : "Pindai kartu peserta untuk mencatat kehadiran"
      }
    >
      {session.status === "loading" && <LoadingState label="Memeriksa sesi…" />}
      {session.status === "error" && <ErrorState message={session.message} />}
      {session.status === "anonymous" && (
        <Notice tone="warning">
          Sesi sudah berakhir.{" "}
          <AppLink className="underline underline-offset-4" href={paths.login}>
            Masuk kembali dengan kode pemulihan
          </AppLink>
          .
        </Notice>
      )}

      {session.status === "authenticated" && contextsError && (
        <ErrorState message={contextsError} onRetry={reloadContexts} />
      )}

      {session.status === "authenticated" && !contextsError && contexts === null && (
        <LoadingState label="Memuat konteks…" />
      )}

      {session.status === "authenticated" && !contextsError && contexts?.length === 0 && (
        <EmptyState>
          Akun ini belum ditugaskan ke Aktivitas/Sesi. Minta Admin Acara menugaskan Anda.
        </EmptyState>
      )}

      {selected && (
        <section className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Konteks aktif
              </p>
              <p className="truncate text-sm font-semibold">{selected.themeName}</p>
              <p className="text-sm text-muted-foreground">{staffContextLabel(selected)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={online ? "success" : "warning"} className="gap-1">
                {online ? (
                  <Wifi aria-hidden="true" className="size-3.5" />
                ) : (
                  <WifiOff aria-hidden="true" className="size-3.5" />
                )}
                {online ? "Online" : "Offline"}
              </Badge>
              {contexts && contexts.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  aria-expanded={showPicker}
                  onClick={() => setPickerOpen((value) => !value)}
                >
                  Ganti konteks
                </Button>
              )}
            </div>
          </div>

          {showPicker && contexts && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="scan-theme">Tema Acara</Label>
                <Select
                  id="scan-theme"
                  value={selected.themeId}
                  disabled={locked}
                  onChange={(event) => {
                    const theme = themes.find((item) => item.themeId === event.target.value);
                    const next =
                      theme?.contexts.find((context) => staffContextReadiness(context).ready) ??
                      theme?.contexts[0];
                    if (next) chooseContext(staffContextKey(next));
                  }}
                >
                  {themes.map((theme) => (
                    <option key={theme.themeId} value={theme.themeId}>
                      {theme.themeName}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="scan-context">Aktivitas / Sesi</Label>
                <Select
                  id="scan-context"
                  value={staffContextKey(selected)}
                  disabled={locked}
                  onChange={(event) => chooseContext(event.target.value)}
                >
                  {themeContexts.map((context) => {
                    const state = staffContextReadiness(context);
                    return (
                      <option
                        key={staffContextKey(context)}
                        value={staffContextKey(context)}
                        disabled={!state.ready}
                      >
                        {staffContextLabel(context)}
                        {state.reason ? ` — ${state.reason}` : ""}
                      </option>
                    );
                  })}
                </Select>
              </div>
            </div>
          )}
        </section>
      )}

      {!selected && contexts && contexts.length > 0 && (
        <section className="space-y-2 rounded-xl border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pilih konteks</p>
          <Select
            aria-label="Pilih Tema, Aktivitas, dan Sesi"
            value=""
            onChange={(event) => chooseContext(event.target.value)}
          >
            <option value="" disabled>
              Pilih Tema / Aktivitas / Sesi…
            </option>
            {contexts.map((context) => {
              const state = staffContextReadiness(context);
              return (
                <option
                  key={staffContextKey(context)}
                  value={staffContextKey(context)}
                  disabled={!state.ready}
                >
                  {context.themeName} · {staffContextLabel(context)}
                  {state.reason ? ` — ${state.reason}` : ""}
                </option>
              );
            })}
          </Select>
        </section>
      )}

      {deepLinkRejected && (
        <Notice tone="warning">
          Konteks pada tautan bukan penugasan aktif akun ini. Pilih konteks dari daftar di atas.
        </Notice>
      )}

      {blocked === "assignment" && (
        <Notice tone="warning">
          Penugasan Anda pada konteks ini berubah atau sudah dicabut. Pemindaian dihentikan.{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={reloadContexts}
          >
            Muat ulang konteks
          </button>
        </Notice>
      )}

      {blocked === "session" && (
        <Notice tone="warning">
          Sesi Anda sudah berakhir.{" "}
          <AppLink className="underline underline-offset-4" href={paths.login}>
            Masuk kembali
          </AppLink>{" "}
          untuk melanjutkan.
        </Notice>
      )}

      {!online && blocked === null && (
        <Notice tone="warning">
          Tidak ada koneksi. Scan tidak dikirim dan tidak diantrekan; sambungkan jaringan lalu
          pindai ulang.
        </Notice>
      )}

      {selected && readiness && !readiness.ready && (
        <Notice tone="warning">
          Konteks belum siap: {readiness.reason}.{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={reloadContexts}
          >
            Periksa konteks
          </button>
        </Notice>
      )}

      {cameraReady && (
        <>
          <ScanFeedback feedback={scanner.feedback} />

          <QrScanner
            paused={locked || blocked !== null || !online}
            facingMode={facing}
            onStart={unlockScanAudio}
            onDetected={(qr) => void handleDetected(qr)}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={muted}
              onClick={toggleMute}
            >
              {muted ? (
                <VolumeX aria-hidden="true" className="size-4" />
              ) : (
                <Volume2 aria-hidden="true" className="size-4" />
              )}
              {muted ? "Suara mati" : "Suara aktif"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked}
              onClick={() => {
                unlockScanAudio();
                setFacing((value) => (value === "environment" ? "user" : "environment"));
              }}
            >
              <SwitchCamera aria-hidden="true" className="size-4" />
              {facing === "environment" ? "Kamera belakang" : "Kamera depan"}
            </Button>
          </div>
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
