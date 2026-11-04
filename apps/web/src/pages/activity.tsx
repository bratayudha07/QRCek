import type { AuditRecord, EventSummary } from "@absensi/shared";
import { Activity } from "lucide-react";
import { useEffect, useState } from "react";

import { AppLink } from "@/components/app-link";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { listEventAudit } from "@/lib/attendance";
import { listEvents } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

export function ActivityPage() {
  const session = useSession();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState("");
  const [items, setItems] = useState<AuditRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listEvents().then((body) => {
      if (cancelled) return;
      if (body.ok) {
        setEvents(body.data.events);
        setEventId((current) => current || body.data.events[0]?.id || "");
      } else setError(body.error.message);
    }).catch(() => { if (!cancelled) setError("Tidak bisa menghubungi server"); })
      .finally(() => { if (!cancelled) setLoadingEvents(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!eventId) { setItems([]); setCursor(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEventAudit(eventId, { action: action.trim() || undefined, limit: 25 })
      .then((body) => {
        if (cancelled) return;
        if (body.ok) { setItems(body.data.items); setCursor(body.data.nextCursor); }
        else setError(body.error.message);
      }).catch(() => { if (!cancelled) setError("Tidak bisa menghubungi server"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, action, refresh]);

  async function loadMore() {
    if (!cursor || !eventId) return;
    setLoading(true);
    try {
      const body = await listEventAudit(eventId, { action: action.trim() || undefined, limit: 25, cursor });
      if (body.ok) { setItems((current) => [...current, ...body.data.items]); setCursor(body.data.nextCursor); }
      else setError(body.error.message);
    } catch { setError("Tidak bisa memuat aktivitas"); }
    finally { setLoading(false); }
  }

  return (
    <AppShell title="Aktivitas" subtitle="Riwayat perubahan yang tercatat di audit">
      {session.status === "anonymous" && <Notice tone="warning">Sesi tidak valid atau sudah berakhir. <AppLink className="underline" href="/masuk">Masuk kembali</AppLink>.</Notice>}
      {error && <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} />}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="space-y-1 text-sm"><span className="font-medium">Acara</span><Select value={eventId} onChange={(event) => setEventId(event.target.value)} disabled={loadingEvents}><option value="">Pilih acara</option>{events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Jenis aktivitas</span><Input value={action} onChange={(event) => setAction(event.target.value)} placeholder="Contoh: attendance.corrected" /></label>
        <Button className="self-end" variant="outline" onClick={() => setRefresh((value) => value + 1)}>Terapkan</Button>
      </div>
      {loadingEvents && <LoadingState label="Memuat acara…" />}
      {loading && <LoadingState label="Memuat aktivitas…" />}
      {!loading && !loadingEvents && eventId && items.length === 0 && <EmptyState>Belum ada aktivitas untuk filter ini.</EmptyState>}
      {items.length > 0 && <ul className="divide-y rounded-xl border">{items.map((item) => <AuditItem key={item.id} item={item} />)}</ul>}
      {cursor && <Button variant="outline" disabled={loading} onClick={() => void loadMore()}>Muat lagi</Button>}
    </AppShell>
  );
}

function AuditItem({ item }: { item: AuditRecord }) {
  return (
    <li className="space-y-2 p-4">
      <div className="flex items-start gap-3"><Activity aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="font-medium">{item.action}</p><p className="text-xs text-muted-foreground">{item.actorName ?? "Sistem"} · {item.entityType}{item.entityId ? ` · ${item.entityId}` : ""} · {formatDateTime(item.createdAt, "Asia/Jakarta")}</p></div></div>
      {item.reason && <p className="text-sm">Alasan: {item.reason}</p>}
      {(item.before !== null || item.after !== null) && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Rincian perubahan</summary><div className="mt-2 grid gap-2 sm:grid-cols-2"><pre className="overflow-x-auto rounded bg-muted/50 p-2">Sebelum: {JSON.stringify(item.before, null, 2)}</pre><pre className="overflow-x-auto rounded bg-muted/50 p-2">Sesudah: {JSON.stringify(item.after, null, 2)}</pre></div></details>}
    </li>
  );
}
