/**
 * API response envelope shared by web and api (DESAIN_API.md §1).
 * `ok` is the discriminant: never branch on HTTP status alone.
 */

export const API_VERSION = "v1" as const;

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CSRF_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "BUSINESS_RULE"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "SYSTEM_ERROR"
  | "DB_UNAVAILABLE";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface HealthPayload {
  service: string;
  version: string;
  status: "ok";
  timestamp: number;
}

export function isApiSuccess<T>(body: ApiResponse<T>): body is ApiSuccess<T> {
  return body.ok === true;
}
