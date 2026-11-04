import { LoaderCircle } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";

import { RecoveryCodePanel } from "@/components/recovery-code-panel";
import { TurnstileWidget, isTurnstileEnabled } from "@/components/turnstile-widget";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { registerAccount } from "@/lib/auth";
import { paths } from "@/lib/router";

/**
 * `/daftar` — self-service registration (ADR-007).
 *
 * Anyone who opens the link can create an account, but the account is an
 * `event_admin` with zero access to existing events: it only ever sees events
 * it creates itself. No email, no password — the recovery code shown once is
 * the only credential.
 */

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; recoveryCode: string; displayName: string }
  | { kind: "error"; message: string };

export function RegisterPage() {
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [widgetAttempt, setWidgetAttempt] = useState(0);
  const [turnstileLoadFailed, setTurnstileLoadFailed] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const handleToken = useCallback((value: string) => {
    setToken(value);
    if (value !== "") setTurnstileLoadFailed(false);
  }, []);
  const handleTurnstileError = useCallback(
    () => {
      setTurnstileLoadFailed(true);
      setStatus({
        kind: "error",
        message:
          "Widget anti-bot tidak dapat dimuat. Pastikan koneksi ke challenges.cloudflare.com tidak diblokir.",
      });
    },
    [],
  );

  function retryTurnstile() {
    setToken("");
    setTurnstileLoadFailed(false);
    setStatus({ kind: "idle" });
    setWidgetAttempt((attempt) => attempt + 1);
  }

  /** The server (or the network) consumed this token: drop it and get a fresh one. */
  const spendToken = useCallback(() => {
    setToken("");
    setResetSignal((value) => value + 1);
  }, []);

  const turnstileEnabled = isTurnstileEnabled();
  const canSubmit =
    displayName.trim().length >= 2 && (!turnstileEnabled || token !== "") && status.kind !== "loading";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "loading" });

    try {
      const body = await registerAccount(displayName, "", token);

      if (body.ok) {
        setStatus({
          kind: "done",
          recoveryCode: body.data.recoveryCode,
          displayName: body.data.user.displayName,
        });
      } else {
        setStatus({ kind: "error", message: body.error.message });
        spendToken();
      }
    } catch {
      setStatus({ kind: "error", message: "Tidak bisa menghubungi server. Periksa koneksi." });
      spendToken();
    }
  }

  if (status.kind === "done") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Akun dibuat</h1>
          <p className="text-sm text-muted-foreground">
            Halo {status.displayName}. Anda bisa membuat acara sendiri sekarang. Acara milik orang
            lain tidak terlihat oleh akun ini.
          </p>
        </header>

        <RecoveryCodePanel recoveryCode={status.recoveryCode} />

        <Button className="w-full" onClick={() => window.location.assign(paths.events)}>
          Buat acara pertama
        </Button>

        <p className="text-xs text-muted-foreground">
          Tanpa kode pemulihan di atas, akun ini tidak bisa dibuka lagi di perangkat lain.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Daftar akun admin</h1>
        <p className="text-sm text-muted-foreground">
          Cukup nama. Tidak perlu email atau kata sandi. Anda akan mendapat kode pemulihan sekali
          tampil — simpan baik-baik.
        </p>
      </header>

      <form className="space-y-4" onSubmit={submit}>
        <Field
          label="Nama Anda"
          htmlFor="display-name"
          hint="Nama ini tampil di acara yang Anda buat."
          required
        >
          <Input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Contoh: Sari Wulandari"
            maxLength={120}
            autoComplete="name"
            required
          />
        </Field>

        <TurnstileWidget
          key={widgetAttempt}
          onToken={handleToken}
          onError={handleTurnstileError}
          resetSignal={resetSignal}
        />

        {status.kind === "error" && (
          <Alert variant="destructive">
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        )}

        {turnstileLoadFailed && (
          <Button type="button" variant="outline" className="w-full" onClick={retryTurnstile}>
            Coba muat verifikasi lagi
          </Button>
        )}

        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {status.kind === "loading" && (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          )}
          Daftar
        </Button>
      </form>

      <a className="text-sm underline underline-offset-4" href={paths.login}>
        Sudah punya kode pemulihan? Masuk
      </a>
    </main>
  );
}
