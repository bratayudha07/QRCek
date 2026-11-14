import type {
  ApiResponse,
  ApiErrorCode,
  ScanReason,
  ScanResult,
  ScanResultPayload,
  StaffContext,
} from "@absensi/shared";
import { SCAN_RESULTS } from "@absensi/shared";

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

/* ───────────────────────────── Q6 scanner state machine ───────────────────── */

/**
 * Feedback classification (Q6 §8.2).
 *
 * The scanner never shows success unless the Worker explicitly returned a known
 * `SUCCESS` result (AC-048). Transport failures, 5xx, ended sessions, and a
 * revoked assignment each get their own copy so "not recorded" is unmistakable.
 */

export type ScanFeedbackKind =
  | "success"
  | "duplicate"
  | "not_entitled"
  | "invalid_qr"
  | "network"
  | "system"
  | "session"
  | "assignment"
  | "context"
  | "rate_limited";

export type ScanFeedbackIcon =
  | "check"
  | "alert"
  | "x"
  | "wifi-off"
  | "log-in"
  | "shield-alert"
  | "timer";

export interface ScanFeedback {
  tone: ScanTone;
  kind: ScanFeedbackKind;
  title: string;
  description: string;
  /** Pure identifier; the component maps it to a Lucide icon. */
  icon: ScanFeedbackIcon;
  /** Screen-reader role: `alert` for failures, `status` otherwise. */
  role: "status" | "alert";
  participantName?: string;
  /** First-scan timestamp for DUPLICATE. */
  occurredAt?: number;
}

function isKnownResult(value: unknown): value is ScanResult {
  return typeof value === "string" && (SCAN_RESULTS as readonly string[]).includes(value);
}

function failureFeedback(
  code: ApiErrorCode,
  message: string,
): ScanFeedback {
  switch (code) {
    case "UNAUTHENTICATED":
    case "CSRF_FAILED":
      return {
        tone: "error",
        kind: "session",
        title: "Sesi berakhir",
        description: `${message || "Sesi tidak valid"} Masuk kembali untuk melanjutkan.`,
        icon: "log-in",
        role: "alert",
      };
    case "FORBIDDEN":
      return {
        tone: "error",
        kind: "assignment",
        title: "Penugasan berubah",
        description: `${message || "Anda tidak ditugaskan pada konteks ini"} Muat ulang konteks sebelum memindai lagi.`,
        icon: "shield-alert",
        role: "alert",
      };
    case "NOT_FOUND":
    case "BUSINESS_RULE":
    case "CONFLICT":
    case "VALIDATION_ERROR":
      return {
        tone: "error",
        kind: "context",
        title: "Konteks tidak valid",
        description: message,
        icon: "alert",
        role: "alert",
      };
    case "RATE_LIMITED":
      return {
        tone: "warning",
        kind: "rate_limited",
        title: "Terlalu banyak scan",
        description: `${message} Tunggu sebentar lalu coba lagi.`,
        icon: "timer",
        role: "alert",
      };
    case "INTERNAL":
    case "SYSTEM_ERROR":
    case "DB_UNAVAILABLE":
    case "PAYLOAD_TOO_LARGE":
      return {
        tone: "error",
        kind: "system",
        title: "Server bermasalah",
        description: `${message || "Permintaan gagal diproses"} Scan belum tercatat; coba lagi.`,
        icon: "x",
        role: "alert",
      };
    default:
      return {
        tone: "error",
        kind: "system",
        title: "Scan gagal",
        description: "Scan belum tercatat. Coba lagi.",
        icon: "x",
        role: "alert",
      };
  }
}

export function classifyScanResponse(
  response: ApiResponse<ScanResultPayload>,
): ScanFeedback {
  if (!response.ok) {
    return failureFeedback(response.error.code, response.error.message);
  }

  const payload = response.data;

  // A payload with an unknown result must never read as success (AC-048).
  if (!isKnownResult(payload?.result)) {
    return {
      tone: "error",
      kind: "system",
      title: "Respons tidak dikenali",
      description: "Scan belum tercatat karena server mengirim hasil yang tidak dikenal.",
      icon: "x",
      role: "alert",
    };
  }

  const participantName = payload.participant?.fullName;
  const base = {
    participantName,
    ...(payload.transaction ? { occurredAt: payload.transaction.occurredAt } : {}),
  };

  switch (payload.result) {
    case "SUCCESS":
      return {
        tone: "success",
        kind: "success",
        title: "Kehadiran tercatat",
        description: payload.message || "Peserta berhasil dicatat hadir.",
        icon: "check",
        role: "status",
        ...base,
      };
    case "DUPLICATE":
      return {
        tone: "warning",
        kind: "duplicate",
        title: "Sudah pernah absen",
        description: payload.message || "Peserta ini sudah tercatat pada konteks ini.",
        icon: "alert",
        role: "status",
        ...base,
      };
    case "NOT_ENTITLED":
      return {
        tone: "warning",
        kind: "not_entitled",
        title: "Peserta belum berhak",
        description: payload.message || "Peserta tidak memenuhi syarat untuk konteks ini.",
        icon: "alert",
        role: "status",
        ...base,
      };
    case "INVALID_QR":
      return {
        tone: "error",
        kind: "invalid_qr",
        title: "QR tidak dikenali",
        description:
          payload.message || "Kode ini bukan kartu peserta yang terdaftar pada acara ini.",
        icon: "x",
        role: "alert",
      };
  }
}

/** A thrown fetch is a network failure, never a business result (FR-122). */
export function classifyScanFailure(error: unknown): ScanFeedback {
  const detail =
    error instanceof Error && error.message ? error.message : "Permintaan tidak terkirim";
  return {
    tone: "error",
    kind: "network",
    title: "Tidak ada koneksi",
    description: `${detail}. Scan belum tercatat. Periksa jaringan lalu coba lagi.`,
    icon: "wifi-off",
    role: "alert",
  };
}

export const FEEDBACK_DURATION_MS = 2000;

export type ScannerPhase = "standby" | "processing" | "feedback" | "offline";

export interface ScannerState {
  phase: ScannerPhase;
  feedback: ScanFeedback | null;
  /** Epoch ms until which a feedback stays on screen. */
  lockedUntil: number | null;
}

export const INITIAL_SCANNER_STATE: ScannerState = {
  phase: "standby",
  feedback: null,
  lockedUntil: null,
};

export type ScannerEvent =
  | { type: "detected"; at: number }
  | { type: "resolved"; at: number; feedback: ScanFeedback }
  | { type: "feedback_elapsed"; at: number }
  | { type: "network_offline"; at: number; feedback?: ScanFeedback }
  | { type: "network_online"; at: number }
  | { type: "context_changed" }
  | { type: "reset" };

/**
 * Pure phase machine (Q6 §8.1). `at` is injected so tests never use wall time.
 *
 * There is deliberately no offline queue: a failed scan is shown as failed and
 * must be repeated by the operator (FR-122, BR-054, NG-05).
 */
export function scannerReducer(state: ScannerState, event: ScannerEvent): ScannerState {
  switch (event.type) {
    case "detected":
      if (state.phase !== "standby") return state;
      return { phase: "processing", feedback: null, lockedUntil: null };

    case "resolved":
      if (state.phase !== "processing") return state;
      return {
        phase: "feedback",
        feedback: event.feedback,
        lockedUntil: event.at + FEEDBACK_DURATION_MS,
      };

    case "feedback_elapsed":
      if (state.phase !== "feedback") return state;
      if (state.lockedUntil === null || event.at < state.lockedUntil) return state;
      return INITIAL_SCANNER_STATE;

    case "network_offline":
      return {
        phase: "offline",
        feedback: event.feedback ?? state.feedback,
        lockedUntil: state.lockedUntil,
      };

    case "network_online":
      if (state.phase !== "offline") return state;
      return INITIAL_SCANNER_STATE;

    case "context_changed":
      if (state.phase !== "standby") return state;
      return INITIAL_SCANNER_STATE;

    case "reset":
      return INITIAL_SCANNER_STATE;
  }
}

/** The camera only runs in standby; every other phase is locked. */
export function scannerIsLocked(state: ScannerState): boolean {
  return state.phase !== "standby";
}

/* ───────────────────────────── Q6 context selection ──────────────────────── */

/** Marker appended to a context that covers every Sesi of its Aktivitas. */
export const ALL_SESSIONS_LABEL = "Semua sesi";

/**
 * Stable identity of one selectable context. This is NOT the assignment id:
 * an Activity-level assignment expands to one context per Sesi, so two options
 * can share the same assignment id.
 */
export function staffContextKey(context: StaffContext): string {
  return `${context.assignmentId}::${context.sessionId ?? ""}`;
}

export function staffContextLabel(context: StaffContext): string {
  return context.sessionName
    ? `${context.activityName} · ${context.sessionName}`
    : `${context.activityName} · ${ALL_SESSIONS_LABEL}`;
}

export interface StaffContextMatch {
  context: StaffContext | null;
  /** A deep link was present but did not match any active assignment. */
  rejected: boolean;
}

type QueryReader = {
  get(name: string): string | null;
  has(name: string): boolean;
};

/**
 * Preselection from `/staff/scan?eventId=&activityId=&sessionId=` (FR-190).
 *
 * A deep link is only a hint: the page still requires the resolved context to
 * be in the caller's own active list, and the Worker re-validates every scan.
 */
export function resolveDeepLinkContext(
  contexts: readonly StaffContext[],
  query: QueryReader,
): StaffContextMatch {
  if (!query.has("eventId")) return { context: null, rejected: false };

  const eventId = query.get("eventId")?.trim() ?? "";
  const activityId = query.get("activityId")?.trim() ?? "";
  const hasSession = query.has("sessionId");
  const sessionId = query.get("sessionId")?.trim() ?? "";

  if (!eventId) return { context: null, rejected: true };

  const match = contexts.find((context) => {
    if (context.themeId !== eventId) return false;
    if (activityId && context.activityId !== activityId) return false;
    if (hasSession) return (context.sessionId ?? "") === sessionId;
    return true;
  });

  return match ? { context: match, rejected: false } : { context: null, rejected: true };
}
