import type { EventStatus } from "@absensi/shared";

/** Indonesian labels for enum values returned by the API. */

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draf",
  active: "Aktif",
  closed: "Ditutup",
  archived: "Diarsipkan",
};

export const EVENT_STATUS_DESCRIPTION: Record<EventStatus, string> = {
  draft: "Masih disiapkan. Peserta dan data acara masih bisa diubah.",
  active: "Acara berjalan. Peserta bisa ditambah dan diperbarui.",
  closed: "Acara selesai. Bisa dibuka kembali atau diarsipkan.",
  archived: "Final dan hanya-baca. Tidak dapat diubah lagi.",
};

export const PARTICIPANT_STATUS_LABEL = {
  active: "Aktif",
  inactive: "Nonaktif",
} as const;

/** Next-step labels for the status buttons, phrased as actions. */
export const EVENT_TRANSITION_LABEL: Record<EventStatus, string> = {
  draft: "Kembalikan ke draf",
  active: "Aktifkan acara",
  closed: "Tutup acara",
  archived: "Arsipkan acara",
};
