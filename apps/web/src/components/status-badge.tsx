import type { EventStatus, ParticipantStatus } from "@absensi/shared";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { EVENT_STATUS_LABEL, PARTICIPANT_STATUS_LABEL } from "@/lib/labels";

const EVENT_VARIANT: Record<EventStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "muted",
  active: "success",
  closed: "warning",
  archived: "outline",
};

const PARTICIPANT_VARIANT: Record<ParticipantStatus, NonNullable<BadgeProps["variant"]>> = {
  active: "success",
  inactive: "muted",
};

export function EventStatusBadge({ status, className }: { status: EventStatus; className?: string }) {
  return (
    <Badge variant={EVENT_VARIANT[status]} className={className}>
      {EVENT_STATUS_LABEL[status]}
    </Badge>
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
    <Badge variant={PARTICIPANT_VARIANT[status]} className={className}>
      {PARTICIPANT_STATUS_LABEL[status]}
    </Badge>
  );
}
