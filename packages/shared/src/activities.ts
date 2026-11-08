import type { ActivityStatus, TransactionType } from "./schemas/activities";

/** Response contracts for Aktivitas (DESAIN_API.md §6). */

export interface Activity {
  id: string;
  themeId: string;
  name: string;
  description: string | null;
  transactionType: TransactionType;
  status: ActivityStatus;
  location: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface ActivityListPayload {
  activities: Activity[];
}

export interface ActivityDetailPayload {
  activity: Activity;
}

export interface ActivityStatusPayload {
  activity: Activity;
}
