import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Page frame inside the global layout: a sticky header and a readable content
 * column.
 *
 * The global navigation (sidebar / bottom nav) lives in `AppLayout`, and so does
 * the event navigation row; this component deliberately knows about neither.
 * The header is opaque, not translucent: a blurred 85 % surface leaves the
 * scrolling content faintly visible under the title.
 */
export function AppShell({
  title,
  subtitle,
  backTo,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-3 px-4 py-3.5">
          {backTo && (
            <button
              type="button"
              onClick={() => navigate(backTo)}
              aria-label="Kembali"
              className="-ml-1 mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
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

      <div className={cn("mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-5", className)}>
        {children}
      </div>
    </div>
  );
}
