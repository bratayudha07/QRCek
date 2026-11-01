import { History, ScanLine } from "lucide-react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import { eventOverviewPath, paths } from "@/lib/router";
import { useSession } from "@/lib/session";
import { PlaceholderPage } from "./placeholder";

/**
 * Staff destinations. Beranda lists the events the officer is assigned to so
 * the move to a staff-only navigation does not hide existing event access; the
 * scanner and history screens are explicit placeholders for the scan stage.
 */
export function StaffHomePage() {
  const session = useSession();

  return (
    <AppShell
      title="Beranda"
      subtitle={
        session.status === "authenticated"
          ? `Halo, ${session.user.displayName}`
          : "Ruang kerja petugas"
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
          untuk mulai memindai.
        </Notice>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <AppLink
          href={paths.staffScan}
          className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 transition-colors duration-150 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ScanLine aria-hidden="true" className="size-5" />
          </span>
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold">Scan QR</span>
            <span className="block text-xs text-muted-foreground">
              Pindai kartu peserta untuk mencatat kehadiran.
            </span>
          </span>
        </AppLink>

        <AppLink
          href={paths.staffHistory}
          className="flex items-start gap-3 rounded-lg border p-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <History aria-hidden="true" className="size-5" />
          </span>
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold">Riwayat</span>
            <span className="block text-xs text-muted-foreground">
              Hasil pemindaian terakhir Anda.
            </span>
          </span>
        </AppLink>
      </section>

      {session.status === "authenticated" && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Acara Anda</h2>

          {session.memberships.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Belum ada acara yang ditugaskan kepada Anda.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {session.memberships.map((membership) => (
                <li key={membership.eventId}>
                  <AppLink
                    href={eventOverviewPath(membership.eventId)}
                    className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {membership.eventName}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {membership.role === "event_admin" ? "Admin acara" : "Petugas"}
                      </span>
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </AppShell>
  );
}

export function StaffScanPage() {
  return (
    <PlaceholderPage
      title="Scan QR"
      subtitle="Pencatatan kehadiran"
      description="Kamera dan pemindaian QR akan tersedia pada tahap scan. Belum ada pemindaian pada versi ini."
      icon={ScanLine}
    />
  );
}

export function StaffHistoryPage() {
  return (
    <PlaceholderPage
      title="Riwayat"
      subtitle="Hasil pemindaian Anda"
      description="Riwayat pemindaian akan tersedia setelah fitur scan aktif."
      icon={History}
    />
  );
}
