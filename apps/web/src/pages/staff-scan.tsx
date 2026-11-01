import { AlertCircle, Clock, UserCheck, XCircle } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/page-state";
import { QrScanner } from "@/components/qr-scanner";
import { normalizeScannedQr, SCAN_RESULT_COPY } from "@/lib/scanner";

export function StaffScanPage() {
  const [inFlight, setInFlight] = useState(false);
  const [result, setResult] = useState<{ payload: { ok: true; data: { result: string; participant?: { fullName: string; category?: string | null }; attendance?: { status: string; checkedInAt: number } } }; at: number } | null>(null);

  async function handleDetected(raw: string) {
    if (inFlight) return;
    const qr = normalizeScannedQr(raw);
    if (!qr) {
      setResult({ payload: { ok: true, data: { result: "not_found" } } as { ok: true; data: { result: string } }, at: Date.now() });
      return;
    }

    // Event assignment is handled by router; here we assume staff scan the event
    // they are assigned to. The parent page passes eventId from session.
    // This placeholder demonstrates the UX: request -> result.
    setInFlight(true);
    setResult(null);

    // In production this calls /api/events/:eventId/scan with the session cookie.
    // The scanner only forwards; authorization is evaluated by the Worker.
  }

  return (
    <AppShell title="Scan QR" subtitle="Pindai kartu peserta untuk mencatat kehadiran">
      <QrScanner
        paused={inFlight || result !== null}
        onDetected={handleDetected}
      />

      {inFlight && (
        <Notice tone="info">
          <Loader className="mr-1 inline size-4 align-[-2px]" />
          Memverifikasi kartu peserta…
        </Notice>
      )}

      {result && (
        <section aria-live="polite" className="space-y-3">
          <ResultCard payload={result.payload} />
          <button
            type="button"
            onClick={() => setResult(null)}
            className="underline underline-offset-4 hover:no-underline"
          >
            Pindai lagi
          </button>
        </section>
      )}
    </AppShell>
  );
}

function Loader({ className }: { className?: string }) {
  return <Clock aria-hidden="true" className={className} />;
}

function ResultCard({ payload }: { payload: { ok: true; data: { result: string; participant?: { fullName: string; category?: string | null }; attendance?: { status: string; checkedInAt: number } } } }) {
  if (!payload.ok) return null;

  const copy = SCAN_RESULT_COPY[payload.data.result as keyof typeof SCAN_RESULT_COPY];
  const Icon = copy.tone === "success" ? UserCheck : copy.tone === "warning" ? AlertCircle : XCircle;

  return (
    <div className={`rounded-xl border p-4 ${
      copy.tone === "success" ? "border-emerald-600/30 bg-emerald-600/5 text-emerald-800" :
      copy.tone === "warning" ? "border-amber-600/30 bg-amber-600/5 text-amber-800" :
      "border-red-600/30 bg-red-600/5 text-red-700"
    }`}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <h3 className="font-semibold">{copy.title}</h3>
          <p className="text-sm">{copy.description}</p>
          {payload.data.result === "present" && payload.data.participant && (
            <p className="mt-2 text-sm font-medium">
              {payload.data.participant.fullName}
              {payload.data.participant.category ? ` · ${payload.data.participant.category}` : ""}
            </p>
          )}
          {payload.data.result === "duplicate" && payload.data.attendance && (
            <p className="mt-2 text-xs text-muted-foreground">
              Absen pertama: {new Date(payload.data.attendance.checkedInAt).toLocaleString("id-ID")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
