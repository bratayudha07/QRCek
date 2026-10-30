import type { ApiResponse, HealthPayload } from "@absensi/shared";

export type HealthState =
  | { status: "loading" }
  | { status: "ok"; version: string }
  | { status: "error"; message: string };

/**
 * Maps an unknown JSON payload to a UI state.
 *
 * Kept pure so it can be unit-tested without a DOM (Fase 0 has no jsdom dep).
 */
export function parseHealthResponse(payload: unknown): HealthState {
  if (typeof payload !== "object" || payload === null) {
    return { status: "error", message: "Respons server tidak dikenali" };
  }

  const body = payload as ApiResponse<HealthPayload>;

  if (body.ok === true) {
    return { status: "ok", version: body.data.version };
  }

  if (body.ok === false) {
    return { status: "error", message: body.error.message };
  }

  return { status: "error", message: "Respons server tidak dikenali" };
}
