import { env } from "cloudflare:workers";

import type { Env } from "../env";

/**
 * Typed handle to the test bindings.
 *
 * The plugin types `env` from the generated `Env` type; we do not run
 * `wrangler types` yet, so the cast keeps `env.DB` strongly typed in tests.
 */
export const testEnv = env as unknown as Env;
