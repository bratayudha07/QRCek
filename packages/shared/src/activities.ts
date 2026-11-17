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
  /**
   * Default consumption quota of the Aktivitas (Q7, A3). `null` for an
   * `attendance` Aktivitas, which has no quota concept. Optional so clients
   * written before Q7 keep compiling; the API always sends it.
   */
  quota?: number | null;
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
