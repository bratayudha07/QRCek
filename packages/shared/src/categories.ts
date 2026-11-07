import type { CategoryStatus } from "./schemas/categories";

/** Response contracts for categories (DESAIN_API.md §5). */

export interface CategorySummary {
  id: string;
  themeId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: CategoryStatus;
  participantCount?: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface CategoryListPayload {
  categories: CategorySummary[];
}

export interface CategoryDetailPayload {
  category: CategorySummary;
}
