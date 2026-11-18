import { useEffect } from "react";

/** Product name in user-facing text (D-019). Identifiers keep the `absensi` prefix. */
export const APP_NAME = "QRCek";

/**
 * Browser tab / history title for a screen.
 *
 * Pure so it can be unit tested without a DOM: `Peserta · Mhs — QRCek`, or just
 * `Masuk — QRCek` when the screen has no detail to show.
 */
export function documentTitle(title: string, detail?: string | null): string {
  const page = detail ? `${title} · ${detail}` : title;
  return `${page} — ${APP_NAME}`;
}

/** Applies the title for the lifetime of the calling component. */
export function useDocumentTitle(title: string, detail?: string | null): void {
  const next = documentTitle(title, detail);

  useEffect(() => {
    document.title = next;
  }, [next]);
}
