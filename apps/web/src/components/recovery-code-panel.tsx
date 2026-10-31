import { CircleCheck } from "lucide-react";

/**
 * Shown exactly once after activation or recovery.
 *
 * The recovery code is the only credential the user must keep (ADR-002). The
 * panel says so plainly and offers a copy button, because a code that gets
 * lost with no way back is a support burden.
 */
export function RecoveryCodePanel({ recoveryCode }: { recoveryCode: string }) {
  return (
    <section className="space-y-3 rounded-lg border border-emerald-600/40 bg-emerald-600/5 p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <CircleCheck aria-hidden="true" className="size-4 text-emerald-600" />
        Akun aktif
      </h2>

      <p className="text-sm text-muted-foreground">
        Simpan kode pemulihan ini sekarang. Kode hanya ditampilkan <strong>satu kali</strong> dan
        dipakai untuk masuk kembali jika perangkat hilang.
      </p>

      <code
        data-testid="recovery-code"
        className="block select-all rounded-md border bg-background px-3 py-2 font-mono text-base tracking-wider"
      >
        {recoveryCode}
      </code>

      <p className="text-xs text-muted-foreground">
        Jangan simpan di chat atau email. Tulis di tempat aman.
      </p>
    </section>
  );
}
