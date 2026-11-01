import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { navigate, paths } from "@/lib/router";

export function NotFoundPage() {
  return (
    <AppShell title="Halaman tidak ditemukan">
      <EmptyState>
        Alamat ini tidak dikenali.
        <div className="mt-3">
          <Button variant="outline" onClick={() => navigate(paths.events)}>
            Ke daftar acara
          </Button>
        </div>
      </EmptyState>
    </AppShell>
  );
}
