import type { Role } from "@absensi/shared";
import { ChevronRight, LogOut } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { logoutSession } from "@/lib/auth";
import { eventPath, navigate, type AppRoute } from "@/lib/router";
import { useSession } from "@/lib/session";

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Superadmin",
  event_admin: "Admin acara",
  officer: "Petugas",
};

export function AccountPage({ route }: { route: AppRoute }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setBusy(true);
    setError(null);

    try {
      await logoutSession();
      navigate("/masuk");
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell route={route} title="Akun" subtitle="Sesi dan keanggotaan acara">
      {session.status === "loading" && <LoadingState label="Memeriksa sesi…" />}

      {session.status === "error" && <ErrorState message={session.message} />}

      {session.status === "anonymous" && (
        <Notice tone="warning">
          Anda belum masuk.{" "}
          <a className="underline underline-offset-4" href="/masuk">
            Masuk dengan kode pemulihan
          </a>
          .
        </Notice>
      )}

      {session.status === "authenticated" && (
        <>
          <section className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Profil</h2>
            <p className="mt-2 text-sm">{session.user.displayName}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABEL[session.user.role]}</p>

            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={logout}
              disabled={busy}
            >
              <LogOut aria-hidden="true" className="size-4" />
              Keluar
            </Button>

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Keanggotaan acara</h2>

            {session.memberships.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Belum ada keanggotaan acara. Superadmin dapat mengakses semua acara tanpa
                keanggotaan.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {session.memberships.map((membership) => (
                  <li key={membership.eventId}>
                    <a
                      href={eventPath(membership.eventId)}
                      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{membership.eventName}</p>
                        <p className="text-xs text-muted-foreground">
                          {membership.role === "event_admin" ? "Admin acara" : "Petugas"}
                        </p>
                      </div>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
