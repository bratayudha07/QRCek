import type { Env } from "./env";
import { handleRequest } from "./app";
import { processOutbox } from "./services/outbox";

/**
 * Worker entrypoint.
 *
 * All routing lives in `app.ts` so tests can call `handleRequest` with an
 * injected clock; this module only adapts the runtime signature.
 *
 * `scheduled` drives the Sheets outbox (ADR-005). Attendance was already
 * committed to D1 before this runs, so a failure here never loses attendance.
 */
export default {
  fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      processOutbox(env, { now: Date.now(), limit: 5 }).catch((error: unknown) => {
        // No participant data, no credentials: just enough to debug.
        console.error("outbox_cron_failed", {
          reason: error instanceof Error ? error.name : "unknown",
        });
      }),
    );
  },
};
