import { CircleAlert, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
    <Alert variant="destructive" className="flex flex-wrap items-start justify-between gap-3">
      <AlertDescription className="flex items-start gap-2">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </AlertDescription>
      {onRetry && (
        <Button variant="link" size="sm" onClick={onRetry} className="underline underline-offset-4">
          Coba lagi
        </Button>
      )}
    </Alert>
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
  const variant = tone === "warning" ? "warning" : tone === "success" ? "success" : "info";

  return (
    <Alert variant={variant} className={cn(className)}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
