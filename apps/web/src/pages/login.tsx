import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { RecoveryCodePanel } from "@/components/recovery-code-panel";
import { Button } from "@/components/ui/button";
import { recoverAccount } from "@/lib/auth";
import { paths } from "@/lib/router";

/**
 * `/masuk` — login with a recovery code.
 *
 * This is the "new or lost device" path: it revokes every old session and
 * issues a fresh code. It is a login form, not a password reset: there is no
 * password anywhere (ADR-002).
 */

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; recoveryCode: string }
  | { kind: "error"; message: string };

export function LoginPage() {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "loading" });

    try {
      const body = await recoverAccount(code, label);

      if (body.ok) {
        setStatus({ kind: "done", recoveryCode: body.data.recoveryCode });
      } else {
        setStatus({ kind: "error", message: body.error.message });
      }
    } catch {
      setStatus({ kind: "error", message: "Tidak bisa menghubungi server. Periksa koneksi." });
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Masuk dengan kode</h1>
        <p className="text-sm text-muted-foreground">
          Gunakan kode pemulihan yang Anda simpan saat aktivasi. Semua sesi lama akan dicabut.
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
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Kode pemulihan</span>
            <input
              className="h-10 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm tracking-wider focus-visible:outline-2 focus-visible:outline-offset-2"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="ABCD-EFGH-IJKL-MNOP-QRST"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={64}
              required
            />
            <span className="block text-xs text-muted-foreground">
              Huruf besar/kecil dan spasi tidak masalah.
            </span>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Nama perangkat (opsional)</span>
            <input
              className="h-10 w-full rounded-md border border-border bg-transparent px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Contoh: HP baru"
              maxLength={80}
              autoComplete="off"
            />
          </label>

          {status.kind === "error" && (
            <p role="alert" className="text-sm text-red-600">
              {status.message}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={status.kind === "loading"}>
            {status.kind === "loading" && (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            )}
            Masuk
          </Button>
        </form>
      )}

      <a className="text-sm underline underline-offset-4" href={paths.register}>
        Belum punya akun? Daftar sebagai admin acara
      </a>

      <a className="text-sm underline underline-offset-4" href="/">
        Kembali ke beranda
      </a>
    </main>
  );
}
