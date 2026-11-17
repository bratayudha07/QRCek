import type {
  Activity,
  CategorySummary,
  ConsumptionQuotaPayload,
  ParticipantSummary,
} from "@absensi/shared";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listCategories, sortCategories } from "@/lib/categories";
import {
  categoryQuotaRows,
  getActivityQuota,
  parseQuotaInput,
  participantQuotaRows,
  quotaUsageLabel,
  saveCategoryQuotas,
  saveDefaultQuota,
  saveParticipantQuotas,
} from "@/lib/consumption";
import { listParticipants } from "@/lib/participants";

const SEARCH_LIMIT = 10;
/** Names for existing overrides come from this bounded first page. */
const NAME_LOOKUP_LIMIT = 100;

type LoadState = "loading" | "ready" | "error";
type SearchState = "idle" | "loading" | "ready" | "error";
type Saving = "default" | "category" | "participant" | null;

/**
 * Quota configuration for one Consumption Aktivitas (Q7, D-014, FR-084).
 *
 * The Aktivitas default applies to every participant without an override; a
 * category override beats the default and an individual override beats both.
 * The Worker resolves the effective value and enforces the ceiling, so this
 * dialog only edits the three levels and shows what the API returned.
 */
export function ConsumptionQuotaDialog({
  eventId,
  activity,
  open,
  onClose,
}: {
  eventId: string;
  activity: Pick<Activity, "id" | "name" | "status" | "archivedAt">;
  open: boolean;
  onClose: () => void;
}) {
  const readOnly = activity.status === "archived" || activity.archivedAt !== null;

  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [quota, setQuota] = useState<ConsumptionQuotaPayload | null>(null);

  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [categoriesError, setCategoriesError] = useState("");
  const [knownNames, setKnownNames] = useState<ReadonlyMap<string, string>>(new Map());

  const [defaultInput, setDefaultInput] = useState("");

  const [categoryTarget, setCategoryTarget] = useState("");
  const [categoryQuotaInput, setCategoryQuotaInput] = useState("");

  const [participantQuery, setParticipantQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [searchSeq, setSearchSeq] = useState(0);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchResults, setSearchResults] = useState<ParticipantSummary[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantSummary | null>(
    null,
  );
  const [participantQuotaInput, setParticipantQuotaInput] = useState("");

  const [saving, setSaving] = useState<Saving>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // A reopened dialog never shows the previous success message.
  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setFormError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setState("loading");
    setError("");

    Promise.all([
      getActivityQuota(eventId, activity.id),
      listCategories(eventId, "all"),
      listParticipants(eventId, { status: "all", limit: NAME_LOOKUP_LIMIT }),
    ])
      .then(([quotaBody, categoryBody, participantBody]) => {
        if (cancelled) return;

        if (!quotaBody.ok) {
          setState("error");
          setError(quotaBody.error.message);
          return;
        }

        setQuota(quotaBody.data);
        setDefaultInput(String(quotaBody.data.defaultQuota));

        if (categoryBody.ok) {
          setCategories(sortCategories(categoryBody.data.categories));
          setCategoriesError("");
        } else {
          setCategories([]);
          setCategoriesError(categoryBody.error.message);
        }

        const names = new Map<string, string>();
        if (participantBody.ok) {
          for (const participant of participantBody.data.items) {
            names.set(participant.id, participant.fullName);
          }
        }
        setKnownNames(names);

        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
        setError("Tidak bisa menghubungi server");
      });

    return () => {
      cancelled = true;
    };
  }, [open, eventId, activity.id, reloadKey]);

  // Search runs on the applied term, so typing never fires a request per key.
  useEffect(() => {
    if (!open || appliedQuery === "") return;

    let cancelled = false;
    setSearchState("loading");

    listParticipants(eventId, {
      query: appliedQuery,
      status: "active",
      limit: SEARCH_LIMIT,
    })
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          setSearchState("error");
          return;
        }
        setSearchResults(body.data.items);
        setSearchState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSearchState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [open, eventId, appliedQuery, searchSeq]);

  function reload() {
    setReloadKey((value) => value + 1);
  }

  async function submitDefault(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);

    const parsed = parseQuotaInput(defaultInput);
    if (!parsed.ok) {
      setFormError(parsed.message);
      return;
    }

    setSaving("default");
    try {
      const body = await saveDefaultQuota(eventId, activity.id, parsed.quota);
      if (!body.ok) {
        setFormError(body.error.message);
        return;
      }
      setNotice("Kuota default disimpan.");
      reload();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(null);
    }
  }

  async function submitCategory() {
    setFormError(null);

    if (!categoryTarget) {
      setFormError("Pilih kategori terlebih dahulu");
      return;
    }
    const parsed = parseQuotaInput(categoryQuotaInput);
    if (!parsed.ok) {
      setFormError(parsed.message);
      return;
    }

    setSaving("category");
    try {
      const body = await saveCategoryQuotas(eventId, activity.id, {
        rules: [{ categoryId: categoryTarget, quota: parsed.quota }],
      });
      if (!body.ok) {
        setFormError(body.error.message);
        return;
      }
      setNotice("Kuota kategori disimpan.");
      setCategoryQuotaInput("");
      reload();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(null);
    }
  }

  async function removeCategoryOverride(categoryId: string) {
    setFormError(null);
    setSaving("category");
    try {
      const body = await saveCategoryQuotas(eventId, activity.id, {
        rules: [{ categoryId, quota: null }],
      });
      if (!body.ok) {
        setFormError(body.error.message);
        return;
      }
      setNotice("Aturan kategori dihapus; kategori kembali memakai kuota default.");
      reload();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(null);
    }
  }

  async function submitParticipant() {
    setFormError(null);

    if (!selectedParticipant) {
      setFormError("Pilih peserta terlebih dahulu");
      return;
    }
    const parsed = parseQuotaInput(participantQuotaInput);
    if (!parsed.ok) {
      setFormError(parsed.message);
      return;
    }

    setSaving("participant");
    try {
      const body = await saveParticipantQuotas(eventId, activity.id, {
        rules: [{ participantId: selectedParticipant.id, quota: parsed.quota }],
      });
      if (!body.ok) {
        setFormError(body.error.message);
        return;
      }
      setNotice(`Kuota ${selectedParticipant.fullName} disimpan.`);
      setParticipantQuotaInput("");
      reload();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(null);
    }
  }

  async function removeParticipantOverride(participantId: string, name: string) {
    setFormError(null);
    setSaving("participant");
    try {
      const body = await saveParticipantQuotas(eventId, activity.id, {
        rules: [{ participantId, quota: null }],
      });
      if (!body.ok) {
        setFormError(body.error.message);
        return;
      }
      setNotice(`Aturan khusus ${name} dihapus.`);
      reload();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(null);
    }
  }

  function chooseParticipant(participant: ParticipantSummary) {
    setSelectedParticipant(participant);
    setKnownNames((current) => new Map(current).set(participant.id, participant.fullName));
  }

  const categoryRows = quota ? categoryQuotaRows(quota, categories) : [];
  const participantRows = quota ? participantQuotaRows(quota, knownNames) : [];
  const usageRows = quota
    ? quota.usage.slice(0, 5).map((row) => ({
        participantId: row.participantId,
        name: knownNames.get(row.participantId) ?? "Peserta di luar daftar",
        used: row.used,
      }))
    : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={`Kuota konsumsi ${activity.name}`}
      className="w-[min(46rem,calc(100vw-1.5rem))]"
    >
      <DialogHeader>
        <DialogTitle>Kuota konsumsi · {activity.name}</DialogTitle>
        <DialogDescription>
          Kuota dihitung per peserta untuk seluruh Aktivitas ini, termasuk semua Sesi. Perubahan
          hanya berlaku untuk transaksi berikutnya.
        </DialogDescription>
      </DialogHeader>

      {readOnly && (
        <Notice tone="warning">
          Aktivitas ini sudah diarsipkan. Kuota hanya dapat dilihat, tidak dapat diubah.
        </Notice>
      )}

      {notice && <Notice tone="success">{notice}</Notice>}

      {formError && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700"
        >
          {formError}
        </p>
      )}

      {state === "loading" ? (
        <LoadingState label="Memuat kuota…" />
      ) : state === "error" ? (
        <ErrorState message={error} onRetry={reload} />
      ) : quota ? (
        <div className="space-y-6">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Kuota default Aktivitas</h3>
            <p className="text-xs text-muted-foreground">
              Berlaku untuk peserta yang tidak punya aturan kategori atau aturan khusus.
            </p>
            <form className="flex flex-wrap items-end gap-2" onSubmit={submitDefault}>
              <Field label="Jumlah" htmlFor="quota-default" className="w-28">
                <Input
                  id="quota-default"
                  inputMode="numeric"
                  value={defaultInput}
                  disabled={readOnly || saving !== null}
                  onChange={(event) => setDefaultInput(event.target.value)}
                />
              </Field>
              <Button type="submit" size="sm" disabled={readOnly || saving !== null}>
                {saving === "default" ? "Menyimpan…" : "Simpan default"}
              </Button>
            </form>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Kuota per kategori</h3>
            <p className="text-xs text-muted-foreground">
              Kategori tanpa aturan memakai kuota default. Satu aturan menggantikan default untuk
              semua peserta di kategori itu.
            </p>

            {categoriesError && <Notice tone="warning">{categoriesError}</Notice>}

            {categoryRows.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                Belum ada aturan kategori; semua memakai kuota default.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Kuota</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryRows.map((row) => (
                    <TableRow key={row.categoryId}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.quota}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={readOnly || saving !== null}
                            onClick={() => {
                              setCategoryTarget(row.categoryId);
                              setCategoryQuotaInput(String(row.quota));
                            }}
                          >
                            Ubah
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={readOnly || saving !== null}
                            onClick={() => void removeCategoryOverride(row.categoryId)}
                          >
                            Hapus
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {!readOnly && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Kategori" htmlFor="quota-category" className="min-w-40 flex-1">
                  <Select
                    id="quota-category"
                    value={categoryTarget}
                    disabled={saving !== null}
                    onChange={(event) => setCategoryTarget(event.target.value)}
                  >
                    <option value="">Pilih kategori…</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                        {category.status === "archived" ? " (diarsipkan)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Kuota" htmlFor="quota-category-value" className="w-24">
                  <Input
                    id="quota-category-value"
                    inputMode="numeric"
                    value={categoryQuotaInput}
                    disabled={saving !== null}
                    onChange={(event) => setCategoryQuotaInput(event.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving !== null}
                  onClick={() => void submitCategory()}
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Atur
                </Button>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Kuota per peserta</h3>
            <p className="text-xs text-muted-foreground">
              Aturan khusus menggantikan kuota kategori dan default untuk satu peserta.
            </p>

            {participantRows.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                Belum ada aturan khusus peserta.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Peserta</TableHead>
                    <TableHead>Kuota</TableHead>
                    <TableHead>Terpakai</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {participantRows.map((row) => (
                    <TableRow key={row.participantId}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.quota}</TableCell>
                      <TableCell>
                        {row.used === null ? "—" : quotaUsageLabel(row.used, row.quota)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={readOnly || saving !== null}
                          onClick={() => void removeParticipantOverride(row.participantId, row.name)}
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                          Hapus
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {!readOnly && (
              <div className="space-y-2">
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(formEvent) => {
                    formEvent.preventDefault();
                    const term = participantQuery.trim();
                    if (term === "") return;
                    setAppliedQuery(term);
                    setSearchSeq((value) => value + 1);
                  }}
                >
                  <Field label="Cari peserta" htmlFor="quota-participant-search" className="min-w-40 flex-1">
                    <Input
                      id="quota-participant-search"
                      value={participantQuery}
                      disabled={saving !== null}
                      placeholder="Nama, NIK, atau email"
                      onChange={(event) => setParticipantQuery(event.target.value)}
                    />
                  </Field>
                  <Button type="submit" size="sm" variant="outline" disabled={saving !== null}>
                    Cari
                  </Button>
                </form>

                {searchState === "loading" && <LoadingState label="Mencari peserta…" />}
                {searchState === "error" && (
                  <Notice tone="warning">Pencarian gagal. Coba lagi.</Notice>
                )}
                {searchState === "ready" && searchResults.length === 0 && (
                  <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    Tidak ada peserta aktif yang cocok.
                  </p>
                )}
                {searchResults.length > 0 && (
                  <ul className="max-h-40 divide-y overflow-y-auto rounded-lg border">
                    {searchResults.map((participant) => {
                      const selected = selectedParticipant?.id === participant.id;
                      return (
                        <li key={participant.id}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => chooseParticipant(participant)}
                            className={`flex w-full items-center justify-between gap-3 p-2 text-left text-sm ${
                              selected ? "bg-muted" : "hover:bg-muted/50"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {participant.fullName}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {participant.externalRef || participant.category || "Tanpa kategori"}
                              </span>
                            </span>
                            {selected && <Badge variant="outline">Dipilih</Badge>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="flex flex-wrap items-end gap-2">
                  <Field
                    label="Kuota peserta terpilih"
                    htmlFor="quota-participant-value"
                    className="w-32"
                    hint={selectedParticipant ? selectedParticipant.fullName : "Belum ada peserta dipilih"}
                  >
                    <Input
                      id="quota-participant-value"
                      inputMode="numeric"
                      value={participantQuotaInput}
                      disabled={saving !== null}
                      onChange={(event) => setParticipantQuotaInput(event.target.value)}
                    />
                  </Field>
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving !== null || selectedParticipant === null}
                    onClick={() => void submitParticipant()}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    Atur
                  </Button>
                </div>
              </div>
            )}
          </section>

          {usageRows.length > 0 && (
            <section className="space-y-1">
              <h3 className="text-sm font-semibold">Pemakaian tertinggi</h3>
              <ul className="divide-y rounded-lg border text-sm">
                {usageRows.map((row) => (
                  <li key={row.participantId} className="flex justify-between gap-3 px-3 py-2">
                    <span className="truncate">{row.name}</span>
                    <span className="text-muted-foreground">{row.used} kali</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Daftar dibatasi 200 peserta dengan pemakaian terbanyak.
              </p>
            </section>
          )}
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving !== null}>
          Tutup
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
