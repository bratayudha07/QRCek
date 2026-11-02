import { useEffect, useRef } from "react";

/**
 * Turnstile widget (ADR-007). Rendered only when the deployment provides a site
 * key; without one the form still works and the Worker falls back to its D1
 * rate limit.
 *
 * The site key is public by design. The matching *secret* never reaches the
 * bundle — it is a Worker secret and is only used in `/api/auth/register`.
 */

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";
let scriptLoadPromise: Promise<void> | null = null;

export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";

export function isTurnstileEnabled(): boolean {
  return TURNSTILE_SITE_KEY.trim() !== "";
}

function loadScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  const script = existing ?? document.createElement("script");

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      script.dataset.loaded = "true";
      if (window.turnstile) resolve();
      else reject(new Error("Turnstile tidak tersedia setelah skrip dimuat"));
    };
    const onError = () => {
      script.remove();
      reject(new Error("Gagal memuat Turnstile"));
    };

    if (existing?.dataset.loaded === "true") {
      onLoad();
      return;
    }

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    scriptLoadPromise = null;
    throw error;
  });

  return scriptLoadPromise;
}

export function TurnstileWidget({
  onToken,
  onError,
  resetSignal = 0,
}: {
  onToken: (token: string) => void;
  onError?: () => void;
  /**
   * Increment to request a fresh challenge. A Turnstile token is single-use:
   * once the server has spent it (even on a rejection) the widget must be reset,
   * otherwise every retry replays a dead token and fails with "duplicate".
   */
  resetSignal?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTurnstileEnabled()) return;

    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;

        widgetIdRef.current = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: onToken,
          "error-callback": onError,
          "expired-callback": () => onToken(""),
          theme: "auto",
        });
      })
      .catch(() => onError?.());

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [onToken, onError]);

  useEffect(() => {
    if (resetSignal === 0) return;
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }, [resetSignal]);

  if (!isTurnstileEnabled()) return null;

  return <div ref={container} className="min-h-[65px]" />;
}
