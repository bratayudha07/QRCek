import { CircleCheck, LoaderCircle, ServerOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";
import { parseHealthResponse, type HealthState } from "@/lib/health";

const ICONS = {
  loading: LoaderCircle,
  ok: CircleCheck,
  error: ServerOff,
} as const;

export function HomePage() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

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

    return () => {
      cancelled = true;
    };
  }, []);

  const StatusIcon = ICONS[health.status];

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Absensi Acara</h1>
        <p className="text-sm text-muted-foreground">
          Fondasi aplikasi. Belum ada fitur absensi, akun, atau acara yang aktif.
        </p>
      </header>

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
