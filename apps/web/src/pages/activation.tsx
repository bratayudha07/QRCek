import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { RecoveryCodePanel } from "@/components/recovery-code-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { activateAccount } from "@/lib/auth";
import { readInviteToken } from "@/lib/invite-token";

/**
 * `/aktivasi#t=<token>` — the landing page for an invite QR.
 *
 * This is the only login path for a new user (ADR-002: no passwords). The token
 * is read from the fragment and posted once; it is never written to
 * localStorage, a cookie, or the address bar of a subsequent request.
 */

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; recoveryCode: string }
  | { kind: "error"; message: string };

export function ActivationPage() {
  const [token] = useState(() => readInviteToken(window.location.hash));
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    setStatus({ kind: "loading" });

    try {
      const body = await activateAccount(token, label);

      if (body.ok) {
        setStatus({ kind: "done", recoveryCode: body.data.recoveryCode });
      } else {
        setStatus({ kind: "error", message: body.error.message });
      }
    } catch {
      setStatus({ kind: "error", message: "Tidak bisa menghubungi server. Periksa koneksi." });
    }
  }

  if (!token) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold tracking-tight">Tautan tidak lengkap</h1>
        <p className="text-sm text-muted-foreground">
          Tautan aktivasi harus memuat token. Pindai ulang QR undangan atau minta tautan baru dari
          admin acara.
        </p>
        <a className="text-sm underline underline-offset-4" href="/">
          Kembali ke beranda
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Aktivasi akun</h1>
        <p className="text-sm text-muted-foreground">
          Token undangan hanya bisa dipakai sekali. Setelah aktif, Anda akan menerima kode
          pemulihan.
        </p>
      </header>

      {status.kind === "done" ? (
        <>
          <RecoveryCodePanel recoveryCode={status.recoveryCode} />
          <a className="text-sm underline underline-offset-4" href="/">
            Lanjut ke beranda
          </a>
        </>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <Field
            label="Nama perangkat (opsional)"
            htmlFor="device-label"
            hint="Membantu Anda mengenali perangkat di daftar sesi."
          >
            <Input
              id="device-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Contoh: HP Android"
              maxLength={80}
              autoComplete="off"
            />
          </Field>

          {status.kind === "error" && (
            <Alert variant="destructive">
              <AlertDescription>{status.message}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={status.kind === "loading"}>
            {status.kind === "loading" && (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            )}
            Aktifkan akun
          </Button>
        </form>
      )}
    </main>
  );
}
