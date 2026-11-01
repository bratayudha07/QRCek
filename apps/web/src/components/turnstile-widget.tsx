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
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";

export function isTurnstileEnabled(): boolean {
  return TURNSTILE_SITE_KEY.trim() !== "";
}

function loadScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Gagal memuat Turnstile"));
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({
  onToken,
  onError,
}: {
  onToken: (token: string) => void;
  onError?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTurnstileEnabled()) return;

    let widgetId: string | null = null;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;

        widgetId = window.turnstile.render(container.current, {
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
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, onError]);

  if (!isTurnstileEnabled()) return null;

  return <div ref={container} className="min-h-[65px]" />;
}
