import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** shadcn/ui radio, rendered as a native control. */
export function Radio({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="radio"
      className={cn(
        "size-4 shrink-0 border-border accent-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
