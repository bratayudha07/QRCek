import type { ScanReason, ScanResult, ScanResultPayload } from "@absensi/shared";

/**
 * Scanner copy and pure helpers.
 *
 * `result` is the stable machine code (ADR-0022); `reason` refines it for the
 * user. The Worker already returns a ready-to-display `message`, so screens use
 * that text and these strings are only a fallback for an older response.
 */

export type ScanTone = "success" | "warning" | "error";

export interface ScanCopy {
  tone: ScanTone;
  title: string;
  description: string;
}

const QR_SCAN_PREFIX = "absensi:v1:";

export const SCAN_RESULT_COPY: Record<ScanResult, ScanCopy> = {
  SUCCESS: {
    tone: "success",
    title: "Kehadiran tercatat",
    description: "Peserta berhasil dicatat hadir.",
  },
  DUPLICATE: {
    tone: "warning",
    title: "Sudah pernah absen",
    description: "Peserta ini sudah tercatat. Waktu absen pertama ditampilkan di bawah.",
  },
  NOT_ENTITLED: {
    tone: "warning",
    title: "Peserta belum berhak",
    description: "Peserta tidak memenuhi syarat untuk Aktivitas/Sesi ini.",
  },
  INVALID_QR: {
    tone: "error",
    title: "QR tidak dikenali",
    description:
      "Kode ini bukan kartu peserta yang terdaftar. Periksa kartu atau minta admin mencetak ulang.",
  },
};

const REASON_TITLE: Partial<Record<ScanReason, string>> = {
  qr_invalid: "QR tidak dikenali",
  participant_inactive: "Peserta tidak aktif",
  entitlement_denied: "Peserta belum berhak",
  theme_archived: "Acara sudah diarsipkan",
  theme_not_active: "Acara belum/sudah tidak menerima absensi",
  activity_not_active: "Aktivitas belum/sudah tidak menerima absensi",
  activity_archived: "Aktivitas sudah diarsipkan",
  session_required: "Sesi belum dipilih",
  context_mismatch: "Konteks absensi tidak cocok",
  session_not_in_progress: "Sesi belum/sudah tidak berlangsung",
  session_archived: "Sesi sudah diarsipkan",
};

/** Title is refined by `reason` when present; the tone always follows `result`. */
export function scanCopy(payload: Pick<ScanResultPayload, "result" | "reason">): ScanCopy {
  const base = SCAN_RESULT_COPY[payload.result];
  const title = payload.reason ? (REASON_TITLE[payload.reason] ?? base.title) : base.title;
  return { ...base, title };
}

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
