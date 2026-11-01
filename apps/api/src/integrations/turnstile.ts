/**
 * Cloudflare Turnstile verification (ADR-007).
 *
 * Turnstile is a free CAPTCHA replacement. It is the *bot* gate on public
 * registration; it is not an identity check and not a substitute for the D1
 * rate limit — both run, in that order, on `/api/auth/register`.
 *
 * `fetch` is injected so tests can answer with a canned payload instead of
 * calling the network (AGENTS.md: no test may hit a third-party service).
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  /** Turnstile error codes, useful in a log; never surfaced to the user. */
  errorCodes: string[];
}

export interface VerifyTurnstileOptions {
  secret: string;
  token: string;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * `false` means "do not let this registration through". Network failure and
 * timeouts are failures: failing open would let anyone skip the check by
 * cutting the link to Cloudflare.
 */
export async function verifyTurnstile(options: VerifyTurnstileOptions): Promise<TurnstileResult> {
  if (options.token.trim() === "") return { success: false, errorCodes: ["missing-input-response"] };

  const body = new URLSearchParams({ secret: options.secret, response: options.token });
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);

  try {
    const response = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });

    // Read structured error codes even for non-2xx responses. This makes
    // provider-side request errors actionable without logging response bodies,
    // which could contain sensitive values if the upstream ever changes shape.
    const payload = (await response.json().catch(() => ({}))) as {
      success?: unknown;
      "error-codes"?: unknown;
    };

    const errorCodes = Array.isArray(payload["error-codes"])
      ? payload["error-codes"].filter((code): code is string => typeof code === "string")
      : [];

    if (!response.ok) {
      return {
        success: false,
        errorCodes: errorCodes.length > 0 ? errorCodes : [`http-${response.status}`],
      };
    }

    return { success: payload.success === true, errorCodes };
  } catch {
    // Abort or transport error. No error code leak, no token in the message.
    return { success: false, errorCodes: ["verification-failed"] };
  } finally {
    clearTimeout(timer);
  }
}
