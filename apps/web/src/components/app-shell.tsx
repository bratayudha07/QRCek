import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Page frame inside the global layout: an optional page header and a readable
 * content column.
 *
 * Two variants, because inside the event workspace the screen name is already
 * on screen:
 *
 * - `default` renders the visible header (title, subtitle, back button,
 *   actions). Used outside the workspace and by its sub-screens (participant
 *   detail, import, QR labels), where nothing else names the page.
 * - `embedded` drops the visible header. The five workspace tabs already name
 *   the screen, so repeating the title in an `h1` cost ~72 px of chrome at the
 *   top of every tab and printed the same word twice. The heading stays for
 *   assistive tech, and the subtitle survives as a one-line lead because it
 *   carries detail the tab label does not.
 *
 * The global navigation (sidebar / bottom nav) lives in `AppLayout`, and so does
 * the event navigation row; this component deliberately knows about neither.
 */
type AppShellCommon = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * `backTo` needs a visible header to point back from, so the embedded variant
 * rejects it at the type level instead of silently ignoring it.
 */
export type AppShellProps = AppShellCommon &
  ({ variant?: "default"; backTo?: string } | { variant: "embedded"; backTo?: never });

export function AppShell(props: AppShellProps) {
  const { title, subtitle, actions, children, className, variant = "default" } = props;
  const backTo = props.variant === "embedded" ? undefined : props.backTo;

  if (variant === "embedded") {
    return (
      <div className="flex min-h-full flex-col">
        <h1 className="sr-only">{subtitle ? `${title} — ${subtitle}` : title}</h1>

        <div className={cn("mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 pb-5 pt-4", className)}>
          {(subtitle || actions) && (
            <div className="app-chrome flex items-start justify-between gap-3">
              {subtitle ? (
                <p className="min-w-0 text-sm text-muted-foreground">{subtitle}</p>
              ) : (
                <span />
              )}
              {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
          )}

          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {/*
        Not sticky on purpose: inside the event workspace the toolbar
        (search + tabs) owns the top edge. Two sticky headers would fight for
        the same offset and the lower one would cover the tabs.
      */}
      <header className="app-chrome border-b border-border/70 bg-background">
        <div className="mx-auto flex w-full max-w-4xl items-start gap-3 px-4 py-3.5">
          {backTo && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate(backTo)}
              aria-label="Kembali"
              className="-ml-1 mt-0.5 shrink-0 rounded-full text-muted-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Button>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>

          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>

      <div className={cn("mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-5", className)}>
        {children}
      </div>
    </div>
  );
}
