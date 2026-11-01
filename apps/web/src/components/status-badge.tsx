import type { EventStatus, ParticipantStatus } from "@absensi/shared";

import { EVENT_STATUS_LABEL, PARTICIPANT_STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

const BASE =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const EVENT_TONE: Record<EventStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  active: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700",
  closed: "border-amber-600/30 bg-amber-600/10 text-amber-700",
  archived: "border-border bg-foreground/5 text-foreground/60",
};

const PARTICIPANT_TONE: Record<ParticipantStatus, string> = {
  active: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700",
  inactive: "border-border bg-muted text-muted-foreground",
};

export function EventStatusBadge({ status, className }: { status: EventStatus; className?: string }) {
  return (
    <span className={cn(BASE, EVENT_TONE[status], className)}>{EVENT_STATUS_LABEL[status]}</span>
  );
}

export function ParticipantStatusBadge({
  status,
  className,
}: {
  status: ParticipantStatus;
  className?: string;
}) {
  return (
    <span className={cn(BASE, PARTICIPANT_TONE[status], className)}>
      {PARTICIPANT_STATUS_LABEL[status]}
    </span>
  );
}
