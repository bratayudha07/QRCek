import type {
  CategoryCreateRequest,
  CategoryDetailPayload,
  CategoryListPayload,
  CategoryStatus,
  CategoryStatusRequest,
  CategorySummary,
  CategoryUpdateRequest,
} from "@absensi/shared";

import { apiRequest } from "./http";

/** Typed bindings for `/api/events/:eventId/categories` (DESAIN_API.md §5). */

export type CategoryStatusFilter = CategoryStatus | "all";

/**
 * Builds the list path. `active` is the API default, so it is omitted instead of
 * being sent explicitly; that keeps the URL stable for the common case.
 */
export function categoriesPath(
  eventId: string,
  status: CategoryStatusFilter = "active",
): string {
  const search = new URLSearchParams();
  if (status !== "active") search.set("status", status);
  const suffix = search.toString();
  return `/api/events/${encodeURIComponent(eventId)}/categories${suffix ? `?${suffix}` : ""}`;
}

export function categoryPath(eventId: string, categoryId: string): string {
  return `${categoriesPath(eventId)}/${encodeURIComponent(categoryId)}`;
}

export function categoryStatusPath(eventId: string, categoryId: string): string {
  return `${categoryPath(eventId, categoryId)}/status`;
}

export function listCategories(
  eventId: string,
  status: CategoryStatusFilter = "active",
) {
  return apiRequest<CategoryListPayload>(categoriesPath(eventId, status));
}

export function createCategory(eventId: string, input: CategoryCreateRequest) {
  return apiRequest<CategoryDetailPayload>(categoriesPath(eventId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCategory(
  eventId: string,
  categoryId: string,
  input: CategoryUpdateRequest,
) {
  return apiRequest<CategoryDetailPayload>(categoryPath(eventId, categoryId), {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function changeCategoryStatus(
  eventId: string,
  categoryId: string,
  input: CategoryStatusRequest,
) {
  return apiRequest<CategoryDetailPayload>(categoryStatusPath(eventId, categoryId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export const CATEGORY_STATUS_LABEL: Record<CategoryStatus, string> = {
  active: "Aktif",
  archived: "Diarsipkan",
};

export function categoryStatusLabel(status: CategoryStatus): string {
  return CATEGORY_STATUS_LABEL[status];
}

/** Select label: name plus the participant count when the API provided one. */
export function categoryOptionLabel(category: CategorySummary): string {
  if (category.participantCount === undefined) return category.name;
  return `${category.name} (${category.participantCount} peserta)`;
}

/** Table cell label for the participant count column. */
export function categoryParticipantLabel(count: number | undefined): string {
  return count === undefined ? "—" : `${count} peserta`;
}

/**
 * Sort order is the admin's intent, the name only breaks ties. Returns a new
 * array so callers can never reorder the API payload in place.
 */
export function sortCategories(categories: readonly CategorySummary[]): CategorySummary[] {
  return [...categories].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "id"),
  );
}

export interface CategorySelectOption {
  value: string;
  label: string;
  archived: boolean;
}

/**
 * Options for the participant form: every active category, plus the currently
 * selected archived one so editing a participant never forces a move. An
 * archived category that is not selected is never offered.
 */
export function categorySelectOptions(
  categories: readonly CategorySummary[],
  selectedId?: string | null,
): CategorySelectOption[] {
  const options: CategorySelectOption[] = sortCategories(
    categories.filter((category) => category.status === "active"),
  ).map((category) => ({
    value: category.id,
    label: categoryOptionLabel(category),
    archived: false,
  }));

  if (!selectedId) return options;

  const selected = categories.find((category) => category.id === selectedId);
  if (!selected || selected.status === "active") return options;

  options.push({
    value: selected.id,
    label: `${selected.name} (diarsipkan)`,
    archived: true,
  });
  return options;
}
