import type { ApiErrorCode } from "@absensi/shared";

/**
 * Every expected failure is an `ApiError`; anything else becomes a generic 500.
 * Handlers throw, the top-level mapper turns it into an envelope. No handler
 * builds an error response by hand.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function unauthenticated(message = "Sesi tidak valid atau sudah berakhir"): ApiError {
  return new ApiError(401, "UNAUTHENTICATED", message);
}

export function forbidden(message = "Anda tidak berwenang untuk tindakan ini"): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(message = "Data tidak ditemukan"): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}

export function validationError(message: string, details?: unknown): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", message, details);
}

export function conflict(message = "Terjadi konflik data"): ApiError {
  return new ApiError(409, "CONFLICT", message);
}

export function businessRule(message: string): ApiError {
  return new ApiError(422, "BUSINESS_RULE", message);
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, "RATE_LIMITED", "Terlalu banyak percobaan. Coba lagi nanti.", {
    retryAfterSeconds,
  }, { "Retry-After": String(retryAfterSeconds) });
}

export function payloadTooLarge(message = "Permintaan terlalu besar"): ApiError {
  return new ApiError(413, "PAYLOAD_TOO_LARGE", message);
}

/**
 * D1 refused the probe. 503 (not 500) tells a monitor "retry, the dependency is
 * down" instead of "the code is broken".
 */
export function dbUnavailable(): ApiError {
  return new ApiError(503, "DB_UNAVAILABLE", "Database tidak dapat diakses");
}
