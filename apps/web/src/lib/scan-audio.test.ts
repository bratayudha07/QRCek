import { describe, expect, it } from "vitest";

import {
  SCAN_MUTE_KEY,
  SCAN_TONES,
  isScannerMuted,
  playScanTone,
  readScannerMuted,
  setScannerMuted,
  toneFor,
  unlockScanAudio,
  writeScannerMuted,
} from "./scan-audio";

/** Pure half of the scanner audio (Q6 §8.3). */

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("tone mapping", () => {
  it("uses a distinct frequency and duration per tone", () => {
    expect(toneFor("success")).toEqual(SCAN_TONES.success);
    expect(toneFor("warning")).toEqual(SCAN_TONES.warning);
    expect(toneFor("error")).toEqual(SCAN_TONES.error);

    const frequencies = new Set(Object.values(SCAN_TONES).map((tone) => tone.frequency));
    expect(frequencies.size).toBe(3);
  });
});

describe("mute preference", () => {
  it("defaults to unmuted and round-trips the local choice", () => {
    const storage = memoryStorage();

    expect(readScannerMuted(storage)).toBe(false);

    writeScannerMuted(true, storage);
    expect(storage.getItem(SCAN_MUTE_KEY)).toBe("1");
    expect(readScannerMuted(storage)).toBe(true);

    writeScannerMuted(false, storage);
    expect(readScannerMuted(storage)).toBe(false);
  });

  it("survives storage that throws (private mode or quota)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(() => writeScannerMuted(true, throwing)).not.toThrow();
    expect(readScannerMuted(throwing)).toBe(false);
    expect(readScannerMuted(null)).toBe(false);
  });

  it("keeps an in-memory mute when storage is blocked", () => {
    setScannerMuted(true, null);
    expect(isScannerMuted(null)).toBe(true);

    setScannerMuted(false, null);
    expect(isScannerMuted(null)).toBe(false);
  });
});

describe("audio without a browser", () => {
  it("is a no-op instead of throwing", () => {
    expect(() => unlockScanAudio()).not.toThrow();
    expect(() => playScanTone("success")).not.toThrow();
  });
});
