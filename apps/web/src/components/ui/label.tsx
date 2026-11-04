import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** shadcn/ui label. */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium", className)} {...props} />;
}
