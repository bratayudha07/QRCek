import type { Env } from "./env";
import { handleRequest } from "./app";

/**
 * Worker entrypoint.
 *
 * All routing lives in `app.ts` so tests can call `handleRequest` with an
 * injected clock; this module only adapts the runtime signature.
 */
export default {
  fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },
};
