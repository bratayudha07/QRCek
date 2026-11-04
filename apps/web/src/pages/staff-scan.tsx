import { AlertCircle, Clock, UserCheck, XCircle } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/page-state";
import { QrScanner } from "@/components/qr-scanner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
          <Button
            variant="link"
            onClick={() => setResult(null)}
            className="px-0 underline underline-offset-4"
          >
            Pindai lagi
          </Button>
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
    <Alert variant={copy.tone === "success" ? "success" : copy.tone === "warning" ? "warning" : "destructive"}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription>
            <p>{copy.description}</p>
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
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}
