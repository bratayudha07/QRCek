import { CircleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence around the route tree.
 *
 * Without it a render error unmounts the whole React tree and leaves a blank
 * page with no way back. The fallback keeps the user in control: reload the
 * bundle, and an optional technical detail for whoever reports the problem.
 *
 * Error boundaries only catch render/lifecycle errors. Failed fetches are
 * already handled per screen by `ErrorState`, and a Worker 4xx/5xx never
 * reaches this component.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Developer console only. No request body, token, or participant data is
    // logged; the stack is what makes a user report actionable.
    console.error("Render error", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-4 py-10"
      >
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <h1 className="text-base font-semibold">Terjadi kesalahan pada halaman ini</h1>
            <p className="text-sm text-muted-foreground">
              Halaman gagal ditampilkan. Data yang sudah tersimpan di server tidak berubah. Muat
              ulang untuk melanjutkan.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            Muat ulang
          </Button>
          <Button type="button" variant="outline" onClick={() => window.location.assign("/")}>
            Kembali ke beranda
          </Button>
        </div>

        <details className="rounded-lg border border-dashed p-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Detail teknis</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {error.message || error.name}
          </pre>
        </details>
      </div>
    );
  }
}
