import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ScanTone } from "@/lib/scanner";

export interface ScanNotification {
  tone: ScanTone;
  title: string;
  description: string;
  participantName?: string;
}

export function ScanToast({
  notification,
  onDismiss,
}: {
  notification: ScanNotification | null;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => dismissRef.current(), 2800);
    return () => window.clearTimeout(timer);
  }, [notification]);

  if (!notification) return null;

  const Icon = notification.tone === "success"
    ? CheckCircle2
    : notification.tone === "warning"
      ? AlertCircle
      : XCircle;
  const toneClass = notification.tone === "success"
    ? "border-emerald-600/30 bg-emerald-50 text-emerald-900"
    : notification.tone === "warning"
      ? "border-amber-600/30 bg-amber-50 text-amber-950"
      : "border-red-600/30 bg-red-50 text-red-900";

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-lg sm:bottom-5">
      <div
        role={notification.tone === "error" ? "alert" : "status"}
        aria-live={notification.tone === "error" ? "assertive" : "polite"}
        className={`flex items-start gap-3 rounded-xl border p-4 shadow-lg ${toneClass}`}
      >
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">{notification.title}</p>
          {notification.participantName && (
            <p className="truncate text-sm font-medium">{notification.participantName}</p>
          )}
          <p className="text-sm opacity-80">{notification.description}</p>
        </div>
      </div>
    </div>
  );
}
