import type { ImportPreviewPayload, ImportResultPayload } from "@absensi/shared";
import { CircleCheck, FileDown, FileUp, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { getEvent } from "@/lib/events";
import { formatBytes, formatCount } from "@/lib/format";
import { importParticipants, participantTemplateUrl } from "@/lib/participants";
import { navigate, participantsPath } from "@/lib/router";

const MAX_BYTES = 2 * 1024 * 1024;

interface ChosenFile {
  name: string;
  size: number;
  text: string;
}

type EventState =
  | { status: "loading" }
  | { status: "ready"; name: string; accessRole: "superadmin" | "event_admin" | "officer" }
  | { status: "error"; message: string };

/**
 * `/admin/events/:id/participants/import` — preview, then confirm.
 *
 * The Worker defaults to `dry_run=true`, so the only way to write is the
 * explicit "Impor sekarang" button below. The preview is not a promise: the
 * confirmation re-sends the same file and the server recomputes the result.
 */
export function ImportPage({ eventId }: { eventId: string }) {
  const [eventState, setEventState] = useState<EventState>({ status: "loading" });
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [preview, setPreview] = useState<ImportPreviewPayload | null>(null);
  const [result, setResult] = useState<ImportResultPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    getEvent(eventId)
      .then((body) => {
        if (cancelled) return;

        if (body.ok) {
          setEventState({
            status: "ready",
            name: body.data.event.name,
            accessRole: body.data.event.accessRole,
          });
        } else {
          setEventState({ status: "error", message: body.error.message });
        }
      })
      .catch(() => {
        if (!cancelled) setEventState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function chooseFile(selected: File | undefined) {
    setError(null);
    setPreview(null);
    setResult(null);

    if (!selected) {
      setFile(null);
      return;
    }

    if (selected.size > MAX_BYTES) {
      setFile(null);
      setError("File melebihi batas 2 MB.");
      return;
    }

    try {
      const text = await selected.text();
      setFile({ name: selected.name, size: selected.size, text });
    } catch {
      setError("File tidak bisa dibaca.");
    }
  }

  async function runPreview() {
    if (!file) return;

    setBusy(true);
    setError(null);

    try {
      const body = await importParticipants(eventId, file.text);

      if (body.ok && body.data.dryRun) {
        setPreview(body.data);
      } else if (!body.ok) {
        setError(body.error.message);
      }
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!file) return;

    setBusy(true);
    setError(null);

    try {
      const body = await importParticipants(eventId, file.text, { confirm: true });

      if (body.ok && !body.data.dryRun) {
        setResult(body.data);
        setPreview(null);
      } else if (!body.ok) {
        setError(body.error.message);
      }
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  const canImport =
    eventState.status === "ready" &&
    (eventState.accessRole === "superadmin" || eventState.accessRole === "event_admin");

  return (
    <AppShell
      title="Impor peserta"
      subtitle={eventState.status === "ready" ? eventState.name : undefined}
      backTo={participantsPath(eventId)}
    >
      {eventState.status === "loading" && <LoadingState label="Memuat acara…" />}

      {eventState.status === "error" && <ErrorState message={eventState.message} />}

      {eventState.status === "ready" && !canImport && (
        <Notice tone="warning">
          Hanya admin acara yang dapat mengimpor peserta. Anda tetap dapat melihat daftar peserta.
        </Notice>
      )}

      {canImport && (
        <>
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">1. Pilih file CSV</h2>

            <p className="text-xs text-muted-foreground">
              Maksimal 2 MB dan 1.000 baris per impor. Kolom yang dikenal:{" "}
              <code className="font-mono">external_ref, full_name, phone, email, category, note</code>
              . Hanya <code className="font-mono">full_name</code> yang wajib.
            </p>

            <a
              href={participantTemplateUrl(eventId)}
              download
              className="inline-flex items-center gap-2 text-sm underline underline-offset-4"
            >
              <FileDown aria-hidden="true" className="size-4" />
              Unduh template CSV
            </a>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-label="File CSV peserta"
              className="block w-full rounded-md border border-dashed p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />

            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {formatBytes(file.size)} · {formatCount(file.text.split("\n").length)}{" "}
                baris terbaca
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={runPreview} disabled={!file || busy}>
                {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                Pratinjau
              </Button>
              <Button variant="ghost" onClick={reset} disabled={busy || (!file && !result)}>
                Bersihkan
              </Button>
            </div>
          </section>

          {error && <ErrorState message={error} />}

          {preview && (
            <section className="space-y-3 rounded-lg border p-4">
              <h2 className="text-sm font-semibold">2. Periksa pratinjau</h2>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Baris", value: preview.total },
                  { label: "Valid", value: preview.valid },
                  { label: "Baru", value: preview.created },
                  { label: "Diperbarui", value: preview.updated },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-md border p-2 text-center">
                    <p className="text-lg font-semibold tabular-nums">{formatCount(stat.value)}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </div>

              {preview.invalid.length > 0 && (
                <Notice tone="warning">
                  <span className="flex items-center gap-2 font-medium">
                    <TriangleAlert aria-hidden="true" className="size-4" />
                    {formatCount(preview.invalid.length)} baris akan dilewati
                  </span>
                  <p className="mt-1 text-xs">
                    Baris valid tetap disimpan. Perbaiki baris di bawah lalu ulangi impor bila perlu.
                  </p>
                </Notice>
              )}

              {preview.sample.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Baris</th>
                        <th className="px-2 py-1.5 font-medium">Nama</th>
                        <th className="px-2 py-1.5 font-medium">Referensi</th>
                        <th className="px-2 py-1.5 font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row) => (
                        <tr key={`${row.line}-${row.externalRef ?? row.fullName}`} className="border-t">
                          <td className="px-2 py-1.5 tabular-nums">{row.line}</td>
                          <td className="px-2 py-1.5">{row.fullName}</td>
                          <td className="px-2 py-1.5">{row.externalRef ?? "—"}</td>
                          <td className="px-2 py-1.5">
                            {row.action === "create" ? "Baru" : "Perbarui"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.invalid.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Baris</th>
                        <th className="px-2 py-1.5 font-medium">Alasan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.invalid.map((row) => (
                        <tr key={row.line} className="border-t">
                          <td className="px-2 py-1.5 tabular-nums">{row.line}</td>
                          <td className="px-2 py-1.5">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={confirmImport} disabled={busy || preview.valid === 0}>
                  {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                  Impor sekarang ({formatCount(preview.valid)} baris)
                </Button>
                <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                  Batal
                </Button>
              </div>
            </section>
          )}

          {result && (
            <section className="space-y-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <CircleCheck aria-hidden="true" className="size-4 text-emerald-600" />
                Impor selesai
              </h2>

              <p className="text-sm">
                {formatCount(result.created)} peserta baru, {formatCount(result.updated)}{" "}
                diperbarui, {formatCount(result.skipped)} baris dilewati.
              </p>

              {result.invalid.length > 0 && (
                <div className="overflow-x-auto rounded-md border bg-background">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Baris</th>
                        <th className="px-2 py-1.5 font-medium">Alasan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.invalid.map((row) => (
                        <tr key={row.line} className="border-t">
                          <td className="px-2 py-1.5 tabular-nums">{row.line}</td>
                          <td className="px-2 py-1.5">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate(participantsPath(eventId))}>Lihat daftar peserta</Button>
                <Button variant="outline" onClick={reset}>
                  <FileUp aria-hidden="true" className="size-4" />
                  Impor file lain
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
