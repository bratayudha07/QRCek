import type { ScanResult } from "@absensi/shared";

/**
 * Scanner copy and pure helpers.
 *
 * Result wording is centralized so the camera screen, tests, and future screens
 * cannot drift into different meanings for `not_found` vs `wrong_event`.
 */

export type ScanTone = "success" | "warning" | "error";

export interface ScanCopy {
  tone: ScanTone;
  title: string;
  description: string;
}

const QR_SCAN_PREFIX = "absensi:v1:";

export const SCAN_RESULT_COPY: Record<ScanResult, ScanCopy> = {
  present: {
    tone: "success",
    title: "Kehadiran tercatat",
    description: "Peserta berhasil dicatat hadir.",
  },
  duplicate: {
    tone: "warning",
    title: "Sudah pernah absen",
    description: "Peserta ini sudah tercatat. Waktu absen pertama ditampilkan di bawah.",
  },
  not_found: {
    tone: "error",
    title: "QR tidak dikenali",
    description: "Kode ini bukan kartu peserta yang terdaftar. Periksa kartu atau minta admin mencetak ulang.",
  },
  wrong_event: {
    tone: "error",
    title: "QR milik acara lain",
    description: "Kartu ini tidak terdaftar untuk acara yang sedang Anda pindai.",
  },
  event_closed: {
    tone: "warning",
    title: "Acara belum/sudah tidak menerima absensi",
    description: "Acara harus berstatus aktif dan berada di dalam jendela waktu yang ditentukan.",
  },
  participant_inactive: {
    tone: "warning",
    title: "Peserta tidak aktif",
    description: "Peserta ini dinonaktifkan oleh admin. Hubungi admin acara untuk tindak lanjut.",
  },
};

export type CameraState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "scanning" }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

/** Maps a `getUserMedia` rejection to an actionable state. */
export function cameraErrorState(error: unknown): CameraState {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return { status: "denied" };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { status: "unavailable" };
  }
  if (name === "NotSupportedError") {
    return { status: "unsupported" };
  }

  return {
    status: "error",
    message: "Kamera tidak dapat dimulai. Coba muat ulang halaman.",
  };
}

export function normalizeScannedQr(raw: string): string | null {
  const value = raw.trim();
  if (!value.startsWith(QR_SCAN_PREFIX)) return null;
  const token = value.slice(QR_SCAN_PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? value : null;
}

export function scanResultSummary(result: ScanResult): string {
  return SCAN_RESULT_COPY[result].title;
}
