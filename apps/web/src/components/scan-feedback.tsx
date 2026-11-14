import {
  AlertCircle,
  CheckCircle2,
  LogIn,
  ShieldAlert,
  Timer,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { ScanFeedback as ScanFeedbackModel, ScanFeedbackIcon, ScanTone } from "@/lib/scanner";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Large result panel for the scanner (Q6 §8.4, FR-189, FR-192).
 *
 * Every state carries an icon, a title, and text — never colour alone
 * (NFR-022). The panel is not interactive and is replaced automatically when
 * the scanner returns to standby.
 */

const ICONS: Record<ScanFeedbackIcon, LucideIcon> = {
  check: CheckCircle2,
  alert: AlertCircle,
  x: XCircle,
  "wifi-off": WifiOff,
  "log-in": LogIn,
  "shield-alert": ShieldAlert,
  timer: Timer,
};

const TONE_CLASS: Record<ScanTone, string> = {
  success: "border-emerald-600/30 bg-emerald-600/10 text-emerald-900",
  warning: "border-amber-600/30 bg-amber-600/10 text-amber-900",
  error: "border-red-600/30 bg-red-600/10 text-red-900",
};

const TIMESTAMP_ZONE = "Asia/Jakarta";

export function ScanFeedback({
  feedback,
  className,
}: {
  feedback: ScanFeedbackModel | null;
  className?: string;
}) {
  if (!feedback) return null;

  const Icon = ICONS[feedback.icon];

  return (
    <section
      role={feedback.role}
      aria-live={feedback.role === "alert" ? "assertive" : "polite"}
      aria-atomic="true"
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 shadow-sm",
        TONE_CLASS[feedback.tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-10 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="text-base font-semibold">{feedback.title}</p>
        {feedback.participantName && (
          <p className="truncate text-sm font-medium">{feedback.participantName}</p>
        )}
        <p className="text-sm opacity-90">{feedback.description}</p>
        {feedback.occurredAt !== undefined && (
          <p className="text-xs opacity-80">
            Absen pertama: {formatDateTime(feedback.occurredAt, TIMESTAMP_ZONE)} WIB
          </p>
        )}
      </div>
    </section>
  );
}
