import type { ApiResponse, CategoryDetailPayload, CategorySummary } from "@absensi/shared";
import { Archive, ArchiveRestore, LoaderCircle, Pencil, Plus, Tags } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  categoryParticipantLabel,
  categoryStatusLabel,
  changeCategoryStatus,
  createCategory,
  listCategories,
  updateCategory,
  type CategoryStatusFilter,
} from "@/lib/categories";

/**
 * Category management dialog (Q2 delta). Categories are archive-only, so there
 * is no delete action here: participants keep pointing at an archived category
 * and the Worker rejects edits on it.
 */
export function CategoryManager({
  eventId,
  open,
  onClose,
  onChanged,
}: {
  eventId: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<CategoryStatusFilter>("all");
  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    listCategories(eventId, statusFilter)
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          setCategories([]);
          setError(body.error.message);
          return;
        }
        setCategories(body.data.categories);
      })
      .catch(() => {
        if (!cancelled) {
          setCategories([]);
          setError("Tidak bisa menghubungi server");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, open, statusFilter, refreshKey]);

  // A closed dialog starts clean: a stale "Ubah" form must not reappear.
  useEffect(() => {
    if (open) return;
    setStatusFilter("all");
    setEditingId(null);
    setName("");
    setDescription("");
    setFormError(null);
    setError(null);
    setNotice(null);
  }, [open]);

  function startEdit(category: CategorySummary) {
    setEditingId(category.id);
    setName(category.name);
    setDescription(category.description ?? "");
    setFormError(null);
    setNotice(null);
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setFormError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (trimmedName === "") {
      setFormError("Nama kategori wajib diisi");
      return;
    }

    const trimmedDescription = description.trim();
    const editing = editingId !== null;
    setSaving(true);

    try {
      const body: ApiResponse<CategoryDetailPayload> = editing
        ? await updateCategory(eventId, editingId, {
            name: trimmedName,
            description: trimmedDescription === "" ? null : trimmedDescription,
          })
        : await createCategory(eventId, {
            name: trimmedName,
            description: trimmedDescription === "" ? null : trimmedDescription,
            sortOrder: 0,
          });

      if (!body.ok) {
        setFormError(body.error.message);
        return;
      }

      resetForm();
      setNotice(editing ? "Kategori diperbarui." : `Kategori ${body.data.category.name} dibuat.`);
      // A new category is always active; show it even if the filter hides it.
      if (!editing && statusFilter === "archived") setStatusFilter("all");
      else setRefreshKey((key) => key + 1);
      onChanged();
    } catch {
      setFormError("Tidak bisa menghubungi server");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(category: CategorySummary, status: "active" | "archived") {
    if (
      status === "archived" &&
      !window.confirm(
        `Arsipkan kategori “${category.name}”? Peserta tetap memakai kategori ini, tetapi kategori arsip tidak bisa dipilih untuk peserta baru.`,
      )
    ) {
      return;
    }

    setRowBusy(category.id);
    setError(null);
    setNotice(null);

    try {
      const body = await changeCategoryStatus(eventId, category.id, { status });
      if (!body.ok) {
        setError(body.error.message);
        return;
      }

      if (editingId === category.id) resetForm();
      setNotice(
        status === "archived" ? "Kategori diarsipkan." : "Kategori diaktifkan kembali.",
      );
      setRefreshKey((key) => key + 1);
      onChanged();
    } catch {
      setError("Tidak bisa menghubungi server");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel="Kelola kategori"
      className="w-[min(56rem,calc(100vw-1.5rem))]"
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Tags aria-hidden="true" className="size-4" />
          Kelola kategori
        </DialogTitle>
        <DialogDescription>
          Kategori mengelompokkan peserta dan menjadi dasar hak peserta. Kategori tidak bisa
          dihapus, hanya diarsipkan.
        </DialogDescription>
      </DialogHeader>

      <form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama kategori" htmlFor="category-name" required>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              placeholder="Contoh: Kelas 5A"
              required
            />
          </Field>

          <Field
            label="Deskripsi (opsional)"
            htmlFor="category-description"
            hint="Maksimal 200 karakter."
          >
            <Textarea
              id="category-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={200}
            />
          </Field>
        </div>

        {formError && (
          <p role="alert" className="rounded-md border border-red-600/30 bg-red-600/5 p-2 text-sm text-red-700">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : editingId ? null : (
              <Plus aria-hidden="true" className="size-4" />
            )}
            {editingId ? "Simpan perubahan" : "Tambah kategori"}
          </Button>
          {editingId && (
            <Button type="button" variant="ghost" onClick={resetForm} disabled={saving}>
              Batal
            </Button>
          )}
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
        <h3 className="font-semibold">Daftar kategori</h3>
        <Field label="Status" htmlFor="category-filter" className="w-40">
          <Select
            id="category-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as CategoryStatusFilter)}
          >
            <option value="active">Aktif</option>
            <option value="archived">Diarsipkan</option>
            <option value="all">Semua</option>
          </Select>
        </Field>
      </div>

      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      {loading ? (
        <LoadingState label="Memuat kategori…" />
      ) : (categories?.length ?? 0) === 0 && !error ? (
        <EmptyState>
          {statusFilter === "all"
            ? "Belum ada kategori. Tambahkan kategori pertama di form atas."
            : "Tidak ada kategori pada filter ini."}
        </EmptyState>
      ) : (categories?.length ?? 0) > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Deskripsi</TableHead>
              <TableHead>Peserta</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories?.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium">{category.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {category.description ?? "—"}
                </TableCell>
                <TableCell>{categoryParticipantLabel(category.participantCount)}</TableCell>
                <TableCell>
                  <Badge variant={category.status === "active" ? "success" : "muted"}>
                    {categoryStatusLabel(category.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {category.status === "active" ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(category)}
                          disabled={rowBusy !== null}
                        >
                          <Pencil aria-hidden="true" className="size-4" />
                          Ubah
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void setStatus(category, "archived")}
                          disabled={rowBusy !== null}
                        >
                          <Archive aria-hidden="true" className="size-4" />
                          Arsipkan
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void setStatus(category, "active")}
                        disabled={rowBusy !== null}
                      >
                        <ArchiveRestore aria-hidden="true" className="size-4" />
                        Aktifkan kembali
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Tutup
        </Button>
      </div>
    </Dialog>
  );
}
