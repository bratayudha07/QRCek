/**
 * Copy resolution for the shared confirmation dialog.
 *
 * Kept out of the component so the defaults can be unit tested without a DOM
 * (web tests run in Node). Call sites pass only what differs from the default.
 */

export type ConfirmTone = "default" | "destructive";

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Label of the button that performs the action. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `destructive` paints the confirm button red and defaults its label. */
  tone?: ConfirmTone;
}

export interface ConfirmCopy {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
}

export function resolveConfirmCopy(options: ConfirmOptions): ConfirmCopy {
  const tone = options.tone ?? "default";

  return {
    title: options.title,
    description: options.description,
    confirmLabel: options.confirmLabel ?? (tone === "destructive" ? "Ya, lanjutkan" : "Lanjutkan"),
    cancelLabel: options.cancelLabel ?? "Batal",
    tone,
  };
}
