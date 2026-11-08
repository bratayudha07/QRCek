import type {
  CustomFieldScope,
  CustomFieldStatus,
  CustomFieldType,
} from "./schemas/custom-fields";

/** Response contracts for custom fields (DESAIN_API.md §5). */

export interface CustomFieldSummary {
  id: string;
  themeId: string;
  key: string;
  label: string;
  description: string | null;
  type: CustomFieldType;
  required: boolean;
  options: string[];
  scope: CustomFieldScope;
  sortOrder: number;
  status: CustomFieldStatus;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface CustomFieldListPayload {
  fields: CustomFieldSummary[];
}

export interface CustomFieldDetailPayload {
  field: CustomFieldSummary;
}
