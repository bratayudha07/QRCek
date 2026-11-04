import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** shadcn/ui checkbox, rendered as a native control. */
export function Checkbox({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 shrink-0 rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
