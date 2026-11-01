import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { navigate, type AppRoute } from "@/lib/router";
import { cn } from "@/lib/utils";

import { Dock } from "./dock";

/**
 * Shared page frame: sticky header, a readable content column, clearance for
 * the floating dock, and the dock itself.
 */
export function AppShell({
  route,
  title,
  subtitle,
  backTo,
  actions,
  children,
  className,
}: {
  route: AppRoute;
  title: string;
  subtitle?: string;
  backTo?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-3 px-4 py-3.5">
          {backTo && (
            <button
              type="button"
              onClick={() => navigate(backTo)}
              aria-label="Kembali"
              className="-ml-1 mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>

          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>

      <main className={cn("mx-auto w-full max-w-3xl space-y-4 px-4 py-5", className)}>
        {children}
      </main>

      <Dock route={route} />
    </div>
  );
}
