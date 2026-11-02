import type { Env } from "./env";
import { handleRequest } from "./app";
import { runHousekeeping } from "./services/housekeeping";
import { processOutbox } from "./services/outbox";

/**
 * Worker entrypoint.
 *
 * All routing lives in `app.ts` so tests can call `handleRequest` with an
 * injected clock; this module only adapts the runtime signature.
 *
 * `scheduled` drives the Sheets outbox (ADR-005) and the bounded table cleanup.
 * Attendance was already committed to D1 before this runs, so a failure here
 * never loses attendance. The two jobs are independent: one failing must not
 * cancel the other.
 */
function cronFailure(job: string): (error: unknown) => void {
  return (error: unknown) => {
    // No participant data, no credentials: just enough to debug.
    console.error("cron_job_failed", {
      job,
      reason: error instanceof Error ? error.name : "unknown",
    });
  };
}

export default {
  fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const now = Date.now();

    ctx.waitUntil(
      Promise.all([
        processOutbox(env, { now, limit: 5 }).catch(cronFailure("outbox")),
        runHousekeeping(env, now).catch(cronFailure("housekeeping")),
      ]),
    );
  },
};
