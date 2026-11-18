/** Read-only audit trail contracts. Raw IP hashes and tokens are never exposed. */
export interface AuditRecord {
  id: string;
  eventId: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: number;
  /** IANA zone of the row's Tema; `null` for actions outside a Tema. */
  timezone: string | null;
}

export interface AuditListPayload {
  items: AuditRecord[];
  nextCursor: string | null;
}
