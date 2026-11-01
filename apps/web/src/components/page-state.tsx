import { CircleAlert, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Shared loading / error / empty blocks, so every screen behaves the same. */

export function LoadingState({ label = "Memuat…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-600/30 bg-red-600/5 p-4 text-sm text-red-700"
    >
      <span className="flex items-start gap-2">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-4 hover:no-underline"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warning" | "success";
  children: ReactNode;
  className?: string;
}) {
  const toneClass = {
    info: "border-border bg-muted/50 text-foreground",
    warning: "border-amber-600/30 bg-amber-600/5 text-amber-800",
    success: "border-emerald-600/30 bg-emerald-600/5 text-emerald-800",
  }[tone];

  return (
    <div className={cn("rounded-lg border p-3 text-sm", toneClass, className)}>{children}</div>
  );
}
