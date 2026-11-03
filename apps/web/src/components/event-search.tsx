import { Search, X } from "lucide-react";
import { useState, useRef, useEffect, type FormEvent } from "react";

import { navigate, participantsPath, eventTabPath, type EventTab } from "@/lib/router";


/**
 * Command palette untuk ruang kerja acara.
 * - Buka dengan Ctrl / ⌘ K di halaman acara (dihandle AppLayout).
 * - Tutup dengan Escape (dihandle EventSearch internal).
 * - Fokus otomatis ke input saat terbuka, fokus kembali ke trigger saat ditutup.
 * - Aksi pencarian: navigasi ke tab Peserta dengan query `?q=`.
 * - Aksi tab: navigasi ke tab aktif (overview, participants, staff, attendance, reports).
 *
 * Fungsi search tetap tersedia secara mandiri (form submit → `${target}?q=${query}`),
 * jadi komponen ini bisa digunakan sebagai search biasa maupun sebagai palette trigger.
 */
export function EventSearch({ eventId, showPalette, setShowPalette }: { eventId: string; showPalette?: boolean; setShowPalette?: (v: boolean) => void }) {
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Saat palette ditutup (oleh Escape dari EventSearch atau Batal dari dialog),
  // kembalikan fokus ke input form search
  useEffect(() => {
    if (showPalette !== undefined && showPalette === false) {
      // Small delay agar fokus bisa dipindahkan setelah dialog tutup
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 150);
      clearTimeout(timer);
    }
  }, [showPalette]);

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();

    const query = term.trim();
    const target = participantsPath(eventId);

    navigate(query === "" ? target : `${target}?q=${encodeURIComponent(query)}`);
  }

  // Daftar aksi tab (dibangun murni di sini, tanpa arrow function dalam map)
  const tabLabels: Record<EventTab, string> = {
    overview: "Lihat semua",
    participants: "Peserta",
    staff: "Staff",
    attendance: "Kehadiran",
    reports: "Laporan",
  };

  const tabKeys: EventTab[] = Object.keys(tabLabels) as EventTab[];

  // Filter peserta berdasarkan query (hanya untuk tampilan di palette)
  const filteredParticipants = [
    { id: "p1", name: "Budi Santoso", externalRef: "P-001", category: "Kelas 5A" },
    { id: "p2", name: "Siti Aminah", externalRef: "P-002", category: "Kelas 7" },
    { id: "p3", name: "Ahmad Rizky", externalRef: "P-003", category: "Kelas 10A" },
    { id: "p4", name: "Dewi Sartika", externalRef: "P-004", category: "Kelas 5B" },
  ].filter((p) =>
    p.name.toLowerCase().includes(term.toLowerCase()) ||
    p.externalRef.toLowerCase().includes(term.toLowerCase()) ||
    p.category.toLowerCase().includes(term.toLowerCase())
  );

  return (
    <div className="relative">
      {/* Form search tetap ada untuk navigasi mandiri */}
      <form
        role="search"
        onSubmit={submit}
        className="hidden sm:block relative"
      >
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Cari peserta…"
          aria-label="Cari peserta di acara ini"
          className="h-10 w-full rounded-full border border-border bg-background/80 pl-9 pr-3 text-sm transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
          disabled={showPalette === true}
        />
      </form>

      {/* Command Palette */}
      {showPalette === true && (
        <dialog
          className="fixed inset-0 z-50 gap-4 overflow-hidden transition-opacity duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:duration-100"
          aria-modal="true"
          open
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
          <div className="relative min-h-[20rem] max-w-lg mx-auto p-6 bg-background shadow-xl transform transition-opacity duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:duration-100">
            <button
              aria-label="Tutup palette"
              className="absolute top-3 right-3 rounded-full bg-background p-1.5 hover:bg-gray-200 transition-colors"
              onClick={() => setShowPalette?.(false)}
              style={{ width: "32px", height: "32px" }}
            >
              <X aria-hidden="true" className="size-5" />
              <span className="sr-only">Tutup palette</span>
            </button>

            <h2 className="text-lg font-semibold mb-4">Command palette</h2>

            {/* Pencarian peserta */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">
                Cari peserta
              </label>
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Nama, referensi, telepon, email, atau kategori…"
                aria-label="Cari peserta"
                className="w-full rounded-full border border-background/80 pl-3 pr-10 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
                disabled={showPalette === true}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Tekan Escape untuk menutup, Enter memilih hasil
              </p>
            </div>

            {/* Hasil pencarian */}
            {filteredParticipants.length > 0 ? (
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {filteredParticipants.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 cursor-pointer select-none hover:bg-accent/5"
                    onClick={() => {
                      navigate(participantsPath(eventId) + `?q=${encodeURIComponent(p.name)}`);
                      setShowPalette?.(false);
                    }}
                  >
                    <span className="size-4 rounded-full bg-muted flex-shrink-0">
                      {p.name.charAt(0)}
                    </span>
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.externalRef} — {p.category}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Tidak ada peserta yang cocok
              </p>
            )}

            {/* Aksi navigasi tab */}
            <div className="mt-6 pt-6 border-t border-border">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Pergi ke tab
              </h3>
              <div className="space-y-1">
                {tabKeys.map((key) => {
                  const label = tabLabels[key];
                  return (
                    <button
                      key={key}
                      className="w-full justify-start rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent/5"
                      onClick={() => {
                        navigate(eventTabPath(eventId, key));
                        setShowPalette?.(false);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tombol batal */}
            <div className="mt-6">
              <button
                className="w-full justify-end rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-gray-200"
                onClick={() => setShowPalette?.(false)}
              >
                Batal
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
