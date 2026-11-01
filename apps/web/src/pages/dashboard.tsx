import { CalendarDays, ChartColumn, Settings } from "lucide-react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import { paths } from "@/lib/router";
import { useSession } from "@/lib/session";

const SHORTCUTS = [
  {
    href: paths.events,
    label: "Acara",
    description: "Kelola acara, peserta, dan impor CSV.",
    icon: CalendarDays,
  },
  {
    href: paths.activity,
    label: "Aktivitas",
    description: "Jejak audit perubahan data.",
    icon: ChartColumn,
  },
  {
    href: paths.settings,
    label: "Pengaturan",
    description: "Profil, sesi, dan keanggotaan acara.",
    icon: Settings,
  },
] as const;

export function DashboardPage() {
  const session = useSession();

  return (
    <AppShell
      title="Dashboard"
      subtitle={
        session.status === "authenticated"
          ? `Selamat datang, ${session.user.displayName}`
          : "Ringkasan ruang kerja"
      }
    >
      {session.status === "loading" && <LoadingState label="Memeriksa sesi…" />}

      {session.status === "error" && <ErrorState message={session.message} />}

      {session.status === "anonymous" && (
        <Notice tone="warning">
          Anda belum masuk.{" "}
          <a className="underline underline-offset-4" href={paths.login}>
            Masuk dengan kode pemulihan
          </a>{" "}
          untuk mengelola acara.
        </Notice>
      )}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Pintasan">
        {SHORTCUTS.map((shortcut) => {
          const Icon = shortcut.icon;

          return (
            <AppLink
              key={shortcut.href}
              href={shortcut.href}
              className="group flex items-start gap-3 rounded-lg border p-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-semibold">{shortcut.label}</span>
                <span className="block text-xs text-muted-foreground">{shortcut.description}</span>
              </span>
            </AppLink>
          );
        })}
      </section>
    </AppShell>
  );
}
