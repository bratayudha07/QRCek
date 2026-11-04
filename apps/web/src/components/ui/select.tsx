import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui select. Kept as a native `<select>` so the mobile OS picker and the
 * built-in keyboard behaviour come for free; pass `appearance-none` yourself
 * when a custom chevron is drawn next to it.
 */
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus-visible:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
