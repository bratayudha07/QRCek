import type { LucideIcon } from "lucide-react";

import { AppShell } from "@/components/app-shell";

/**
 * Honest placeholder for a destination that exists in the navigation but whose
 * feature belongs to a later stage (AGENTS.md: do not implement features before
 * their phase is opened).
 */
export function PlaceholderPage({
  title,
  subtitle,
  description,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="rounded-lg border border-dashed p-8 text-center">
        <Icon aria-hidden="true" className="mx-auto mb-3 size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Belum tersedia</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </AppShell>
  );
}
