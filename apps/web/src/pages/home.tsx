import type { Role } from "@absensi/shared";
import { CircleCheck, LoaderCircle, ServerOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchMe, logoutSession } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { parseHealthResponse, type HealthState } from "@/lib/health";

const ICONS = {
  loading: LoaderCircle,
  ok: CircleCheck,
  error: ServerOff,
} as const;

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Superadmin",
  event_admin: "Admin acara",
  officer: "Petugas",
};

type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; name: string; role: Role }
  | { status: "error"; message: string };

export function HomePage() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(apiUrl("/api/health"))
      .then(async (response) => parseHealthResponse(await response.json()))
      .then((state) => {
        if (!cancelled) setHealth(state);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHealth({
            status: "error",
            message: error instanceof Error ? error.message : "Gagal menghubungi server",
          });
        }
      });

    fetchMe()
      .then((body) => {
        if (cancelled) return;

        if (body.ok) {
          setSession({
            status: "authenticated",
            name: body.data.user.displayName,
            role: body.data.user.role,
          });
        } else if (body.error.code === "UNAUTHENTICATED") {
          setSession({ status: "anonymous" });
        } else {
          setSession({ status: "error", message: body.error.message });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession({ status: "error", message: "Tidak bisa menghubungi server" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await logoutSession();
    setSession({ status: "anonymous" });
  }

  const StatusIcon = ICONS[health.status];

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Absensi Acara</h1>
        <p className="text-sm text-muted-foreground">
          Fondasi identitas dan akses. Pengelolaan peserta, pemindaian QR, dan rekap menyusul pada
          tahap berikutnya.
        </p>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">Akun</h2>

        {session.status === "loading" && (
          <p className="mt-1 text-sm text-muted-foreground">Memeriksa sesi…</p>
        )}

        {session.status === "anonymous" && (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              Anda belum masuk. Petugas baru memakai tautan undangan dari admin acara.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
                href="/masuk"
              >
                Masuk dengan kode pemulihan
              </a>
            </div>
          </div>
        )}

        {session.status === "authenticated" && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm" data-testid="session-user">
                {session.name}
              </p>
              <p className="text-xs text-muted-foreground">{ROLE_LABEL[session.role]}</p>
            </div>
            <Button variant="outline" size="sm" onClick={logout}>
              Keluar
            </Button>
          </div>
        )}

        {session.status === "error" && (
          <p className="mt-1 text-sm text-red-600">{session.message}</p>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <StatusIcon
            aria-hidden="true"
            className={
              health.status === "ok"
                ? "size-4 text-emerald-600"
                : health.status === "error"
                  ? "size-4 text-red-600"
                  : "size-4 text-muted-foreground"
            }
          />
          Status API
        </h2>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="health-status">
          {health.status === "loading" && "Memeriksa…"}
          {health.status === "ok" && `Terhubung (API ${health.version})`}
          {health.status === "error" && `Gagal: ${health.message}`}
        </p>
      </section>

      <Button variant="outline" onClick={() => window.location.reload()}>
        Periksa ulang
      </Button>
    </main>
  );
}
