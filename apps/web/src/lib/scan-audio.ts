import type { ScanTone } from "./scanner";

/**
 * Scanner audio feedback with the Web Audio API (Q6 §8.3, D-013).
 *
 * No asset files and no dependency: three short oscillator tones. The context is
 * created lazily and resumed on a user gesture (start camera / toggle mute), as
 * iOS Safari requires. Audio is never the only indicator — the UI always shows
 * text and an icon (FR-192, NFR-022).
 */

export const SCAN_MUTE_KEY = "absensi:scan:muted";

export interface ScanToneSpec {
  frequency: number;
  durationMs: number;
  gain: number;
}

export const SCAN_TONES: Record<ScanTone, ScanToneSpec> = {
  success: { frequency: 880, durationMs: 120, gain: 0.08 },
  warning: { frequency: 440, durationMs: 180, gain: 0.08 },
  error: { frequency: 220, durationMs: 300, gain: 0.1 },
};

export function toneFor(tone: ScanTone): ScanToneSpec {
  return SCAN_TONES[tone];
}

type MuteStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): MuteStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Private mode / blocked storage: fall back to in-memory only.
    return null;
  }
}

/** Mute preference is local to the device and survives reloads when storage works. */
export function readScannerMuted(storage: MuteStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SCAN_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeScannerMuted(
  muted: boolean,
  storage: MuteStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(SCAN_MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Quota or privacy mode: the in-memory toggle still works for this session.
  }
}

// Private mode can block storage entirely, but the mute button must still work
// for this session (plan risk table).
let mutedInMemory = false;

export function setScannerMuted(
  muted: boolean,
  storage: MuteStorage | null = defaultStorage(),
): void {
  mutedInMemory = muted;
  writeScannerMuted(muted, storage);
}

export function isScannerMuted(storage: MuteStorage | null = defaultStorage()): boolean {
  return mutedInMemory || readScannerMuted(storage);
}

type AudioContextCtor = new () => AudioContext;

let audioContext: AudioContext | null = null;
let scheduledUntil = 0;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function getContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  if (!audioContext) {
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
  }
  return audioContext;
}

/** Call from a user gesture before the first tone (iOS Safari). */
export function unlockScanAudio(): void {
  const context = getContext();
  if (context && context.state === "suspended") void context.resume();
}

/**
 * Plays one tone. A new tone never stacks on a playing one: it is scheduled
 * 250 ms after the previous tone ends.
 */
export function playScanTone(tone: ScanTone): void {
  if (isScannerMuted()) return;

  const context = getContext();
  if (!context) return;

  try {
    const spec = toneFor(tone);
    const now = context.currentTime;
    const startAt = now < scheduledUntil ? scheduledUntil + 0.25 : now;
    const durationSeconds = spec.durationMs / 1000;

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(spec.frequency, startAt);
    gain.gain.setValueAtTime(spec.gain, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + durationSeconds);

    scheduledUntil = startAt + durationSeconds;
  } catch {
    // Audio must never break scanning; the visual feedback is authoritative.
  }
}
