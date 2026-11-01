import type {
  EventSummary,
  LabelFieldKey,
  ParticipantSummary,
  QrLabelPayload,
} from "@absensi/shared";
import {
  LABEL_FIELDS,
  MAX_LABEL_FIELDS,
  QR_LABEL_BATCH_MAX,
  labelFieldMeta,
} from "@absensi/shared";
import { ArrowDown, ArrowUp, LoaderCircle, Printer, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { LabelSheet } from "@/components/label-sheet";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { getEvent } from "@/lib/events";
import { listParticipants } from "@/lib/participants";
import {
  getLabelConfig,
  issueQrLabels,
  moveLabelField,
  saveLabelConfig,
  toggleLabelField,
  labelPrintCss,
  type LabelFormat,
} from "@/lib/qr-labels";
import { participantsPath } from "@/lib/router";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

type EventState =
  | { status: "loading" }
  | { status: "ready"; event: EventSummary }
  | { status: "error"; message: string };

type ConfigState =
  | { status: "loading" }
  | { status: "ready"; fields: LabelFieldKey[]; showEventName: boolean }
  | { status: "error"; message: string };

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; payload: QrLabelPayload }
  | { status: "error"; message: string };

/**
 * `/admin/events/:id/participants/labels` — choose participants, choose which
 * fields appear, preview, then print. Credentials are issued only by the
 * preview call, so opening this page never touches the database.
 */
export function EventLabelsPage({ eventId }: { eventId: string }) {
  const [eventState, setEventState] = useState<EventState>({ status: "loading" });
  const [configState, setConfigState] = useState<ConfigState>({ status: "loading" });

  const [format, setFormat] = useState<LabelFormat>("a4");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configNotice, setConfigNotice] = useState<string | null>(null);

  const [items, setItems] = useState<ParticipantSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [listKey, setListKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    setEventState({ status: "loading" });

    getEvent(eventId)
      .then((body) => {
        if (cancelled) return;
        setEventState(
          body.ok
            ? { status: "ready", event: body.data.event }
            : { status: "error", message: body.error.message },
        );
      })
      .catch(() => {
        if (!cancelled) setEventState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    setConfigState({ status: "loading" });

    getLabelConfig(eventId)
      .then((body) => {
        if (cancelled) return;
        setConfigState(
          body.ok
            ? {
                status: "ready",
                fields: body.data.fields,
                showEventName: body.data.showEventName,
              }
            : { status: "error", message: body.error.message },
        );
      })
      .catch(() => {
        if (!cancelled) setConfigState({ status: "error", message: "Tidak bisa menghubungi server" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    setListState("loading");
    setListError("");

    listParticipants(eventId, { status: "active", limit: PAGE_SIZE })
      .then((body) => {
        if (cancelled) return;
        if (body.ok) {
          setItems(body.data.items);
          setNextCursor(body.data.nextCursor);
          setListState("ready");
        } else {
          setListError(body.error.message);
          setListState("error");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setListError("Tidak bisa menghubungi server");
          setListState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, listKey]);

  const fields = configState.status === "ready" ? configState.fields : [];
  const showEventName = configState.status === "ready" ? configState.showEventName : true;

  function updateConfig(next: { fields?: LabelFieldKey[]; showEventName?: boolean }) {
    setConfigState((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            fields: next.fields ?? current.fields,
            showEventName: next.showEventName ?? current.showEventName,
          }
        : current,
    );
    setConfigNotice(null);
    setPreview({ status: "idle" });
  }

  async function loadMoreParticipants() {
    if (!nextCursor) return;

    setLoadingMore(true);

    try {
      const body = await listParticipants(eventId, {
        status: "active",
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });

      if (body.ok) {
        setItems((current) => [...current, ...body.data.items]);
        setNextCursor(body.data.nextCursor);
      } else {
        setListError(body.error.message);
      }
    } catch {
      setListError("Tidak bisa menghubungi server");
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleSelected(participantId: string) {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(participantId)) {
        next.delete(participantId);
      } else if (next.size < QR_LABEL_BATCH_MAX) {
        next.add(participantId);
      }

      return next;
    });
    setPreview({ status: "idle" });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);

      for (const item of items) {
        if (next.size >= QR_LABEL_BATCH_MAX) break;
        next.add(item.id);
      }

      return next;
    });
    setPreview({ status: "idle" });
  }

  async function persistConfig() {
    if (configState.status !== "ready") return;

    setSavingConfig(true);
    setConfigNotice(null);

    try {
      const body = await saveLabelConfig(eventId, {
        fields: configState.fields,
        showEventName: configState.showEventName,
      });

      setConfigNotice(
        body.ok ? "Pengaturan label disimpan." : body.error.message,
      );
    } catch {
      setConfigNotice("Tidak bisa menghubungi server");
    } finally {
      setSavingConfig(false);
    }
  }

  async function buildPreview() {
    if (selected.size === 0) {
      setPreview({ status: "error", message: "Pilih minimal satu peserta terlebih dahulu." });
      return;
    }

    if (configState.status !== "ready") {
      setPreview({ status: "error", message: "Pengaturan label belum siap." });
      return;
    }

    setPreview({ status: "loading" });

    try {
      const body = await issueQrLabels(eventId, {
        format,
        fields: configState.fields,
        showEventName: configState.showEventName,
        participantIds: [...selected].slice(0, QR_LABEL_BATCH_MAX),
      });

      setPreview(
        body.ok
          ? { status: "ready", payload: body.data }
          : { status: "error", message: body.error.message },
      );
    } catch {
      setPreview({ status: "error", message: "Tidak bisa menghubungi server" });
    }
  }

  if (eventState.status === "loading" || configState.status === "loading") {
    return (
      <AppShell title="Label QR">
        <LoadingState label="Memuat acara…" />
      </AppShell>
    );
  }

  if (eventState.status === "error") {
    return (
      <AppShell title="Label QR">
        <ErrorState message={eventState.message} />
      </AppShell>
    );
  }

  const { event } = eventState;
  const canPrint = event.accessRole !== "officer";

  if (!canPrint) {
    return (
      <AppShell title="Label QR" subtitle={event.name} backTo={participantsPath(eventId)}>
        <Notice>Hanya admin acara yang dapat membuat dan mencetak label QR peserta.</Notice>
      </AppShell>
    );
  }

  if (configState.status === "error") {
    return (
      <AppShell title="Label QR" subtitle={event.name} backTo={participantsPath(eventId)}>
        <ErrorState message={configState.message} />
      </AppShell>
    );
  }

  const isArchived = event.status === "archived";
  const atSelectionLimit = selected.size >= QR_LABEL_BATCH_MAX;

  return (
    <AppShell title="Label QR" subtitle={event.name} backTo={participantsPath(eventId)}>
      <style>{labelPrintCss(format)}</style>

      <div className="space-y-4 print:hidden">
        {isArchived && (
          <Notice tone="warning">
            Acara sudah diarsipkan. Label masih boleh dicetak, tetapi pengaturan label tidak dapat
            diubah.
          </Notice>
        )}

        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Field pada label</h2>
            <span className="text-xs text-muted-foreground">
              {fields.length} dari {MAX_LABEL_FIELDS} field
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Pilih atribut peserta yang dicetak. Urutan di bawah menentukan urutan baris; QR selalu
            ikut tercetak.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {LABEL_FIELDS.map((meta) => {
              const active = fields.includes(meta.key);
              const disabled = !active && fields.length >= MAX_LABEL_FIELDS;

              return (
                <label
                  key={meta.key}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                    disabled ? "opacity-50" : "hover:bg-muted/40",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={disabled || isArchived}
                    onChange={() => updateConfig({ fields: toggleLabelField(fields, meta.key) })}
                  />
                  {meta.label}
                </label>
              );
            })}
          </div>

          <ol className="divide-y rounded-md border">
            {fields.map((key, index) => {
              const meta = labelFieldMeta(key);

              return (
                <li key={key} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="w-5 text-xs text-muted-foreground">{index + 1}.</span>
                  <span className="flex-1">{meta.label}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Naikkan ${meta.label}`}
                    disabled={index === 0 || isArchived}
                    onClick={() => updateConfig({ fields: moveLabelField(fields, key, -1) })}
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Turunkan ${meta.label}`}
                    disabled={index === fields.length - 1 || isArchived}
                    onClick={() => updateConfig({ fields: moveLabelField(fields, key, 1) })}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ol>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showEventName}
              disabled={isArchived}
              onChange={(changeEvent) =>
                updateConfig({ showEventName: changeEvent.target.checked })
              }
            />
            Cetak nama acara
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={persistConfig}
              disabled={savingConfig || isArchived}
            >
              {savingConfig ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Save aria-hidden="true" className="size-4" />
              )}
              Simpan pengaturan
            </Button>
            {configNotice && <span className="text-xs text-muted-foreground">{configNotice}</span>}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Format cetak</h2>

          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { value: "a4", title: "A4 (3 × 8)", hint: "24 label per halaman, margin 8 mm" },
                { value: "sticker", title: "Stiker 50 × 30 mm", hint: "Satu label per halaman" },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm",
                  format === option.value ? "border-foreground/40 bg-muted/40" : "hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="label-format"
                  value={option.value}
                  checked={format === option.value}
                  onChange={() => {
                    setFormat(option.value);
                    setPreview({ status: "idle" });
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">{option.title}</span>
                  <span className="block text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Peserta</h2>
            <span className="text-xs text-muted-foreground">
              {formatCount(selected.size)} dipilih · maksimal {QR_LABEL_BATCH_MAX}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={selectVisible}>
              Pilih yang tampil
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={selected.size === 0}
              onClick={() => {
                setSelected(new Set());
                setPreview({ status: "idle" });
              }}
            >
              Kosongkan pilihan
            </Button>
          </div>

          {listState === "loading" && <LoadingState label="Memuat peserta…" />}

          {listState === "error" && (
            <ErrorState message={listError} onRetry={() => setListKey((key) => key + 1)} />
          )}

          {listState === "ready" && items.length === 0 && (
            <EmptyState>Belum ada peserta aktif pada acara ini.</EmptyState>
          )}

          {listState === "ready" && items.length > 0 && (
            <ul className="divide-y rounded-md border">
              {items.map((participant) => {
                const isSelected = selected.has(participant.id);

                return (
                  <li key={participant.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                        !isSelected && atSelectionLimit ? "opacity-50" : "hover:bg-muted/40",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!isSelected && atSelectionLimit}
                        onChange={() => toggleSelected(participant.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{participant.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[participant.externalRef, participant.category]
                            .filter(Boolean)
                            .join(" · ") || "Tanpa referensi"}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {nextCursor && listState === "ready" && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={loadMoreParticipants} disabled={loadingMore}>
                {loadingMore && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                Muat lebih banyak
              </Button>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={buildPreview} disabled={preview.status === "loading" || selected.size === 0}>
            {preview.status === "loading" && (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            )}
            Pratinjau label
          </Button>
          <Button
            variant="outline"
            onClick={() => window.print()}
            disabled={preview.status !== "ready"}
          >
            <Printer aria-hidden="true" className="size-4" />
            Cetak
          </Button>
        </div>

        {preview.status === "error" && <ErrorState message={preview.message} onRetry={buildPreview} />}
      </div>

      {preview.status === "ready" && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <h2 className="text-sm font-semibold">
              Pratinjau {formatCount(preview.payload.labels.length)} label
            </h2>
            <span className="text-xs text-muted-foreground">
              {format === "a4" ? "A4 · 3 × 8 per halaman" : "Stiker 50 × 30 mm"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-white p-4 print:overflow-visible print:border-0 print:p-0">
            <LabelSheet payload={preview.payload} format={format} />
          </div>
        </section>
      )}

      {preview.status === "loading" && <LoadingState label="Menyiapkan label…" />}
    </AppShell>
  );
}
