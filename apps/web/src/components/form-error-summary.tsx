import { useEffect, useRef } from "react";

/**
 * Accessible summary of the problems that blocked a submit.
 *
 * `role="alert"` announces it, and the box takes focus after a failed submit so
 * keyboard and screen-reader users land on the reason instead of staying on the
 * submit button. Field-level messages still live next to each control; this is
 * the "what went wrong" overview for long forms.
 */
export function FormErrorSummary({
  errors,
  title = "Periksa kembali isian berikut:",
}: {
  errors: readonly string[];
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = errors.join("\u0000");

  useEffect(() => {
    if (key !== "") ref.current?.focus();
  }, [key]);

  if (errors.length === 0) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-live="assertive"
      className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
    >
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {[...new Set(errors)].map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
