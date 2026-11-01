import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { navigate, type AppRoute } from "@/lib/router";

export function NotFoundPage({ route }: { route: AppRoute }) {
  return (
    <AppShell route={route} title="Halaman tidak ditemukan">
      <EmptyState>
        Alamat ini tidak dikenali.
        <div className="mt-3">
          <Button variant="outline" onClick={() => navigate("/acara")}>
            Ke daftar acara
          </Button>
        </div>
      </EmptyState>
    </AppShell>
  );
}
