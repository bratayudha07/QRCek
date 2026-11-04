import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  const variant = notification.tone === "success"
    ? "success"
    : notification.tone === "warning"
      ? "warning"
      : "destructive";

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-lg sm:bottom-5">
      <Alert
        variant={variant}
        role={notification.tone === "error" ? "alert" : "status"}
        aria-live={notification.tone === "error" ? "assertive" : "polite"}
        className="pointer-events-auto flex items-start gap-3 shadow-lg"
      >
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <AlertTitle className="font-semibold">{notification.title}</AlertTitle>
          {notification.participantName && (
            <p className="truncate text-sm font-medium">{notification.participantName}</p>
          )}
          <AlertDescription className="opacity-80">
            {notification.description}
          </AlertDescription>
        </div>
      </Alert>
    </div>
  );
}
