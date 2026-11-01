import type { IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, LoaderCircle, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CameraState } from "@/lib/scanner";
import { cameraErrorState } from "@/lib/scanner";

/**
 * Mobile camera QR reader.
 *
 * Two decoders on purpose (ADR risk R10):
 *   1. `BarcodeDetector` when the browser has it (Chrome/Android) — no bundle.
 *   2. `@zxing/browser` dynamically imported everywhere else (iOS Safari).
 *
 * The camera starts only from a click, because iOS requires a user gesture.
 * Detections are debounced per payload; the parent ALSO guards with an
 * in-flight ref, so a camera glitch cannot submit the same scan twice.
 *
 * Nothing here trusts the QR content: it is forwarded to the Worker, which
 * performs authentication, HMAC lookup, and event scoping.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

interface ScannerProps {
  /** While `true`, detections are ignored (request in flight or result shown). */
  paused: boolean;
  onDetected: (value: string) => void;
}

const DETECTION_DEBOUNCE_MS = 1_500;

export function QrScanner({ paused, onDetected }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const pausedRef = useRef(paused);
  const detectedRef = useRef<{ value: string; at: number } | null>(null);
  const onDetectedRef = useRef(onDetected);

  const [state, setState] = useState<CameraState>({ status: "idle" });

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  function stop(): void {
    runningRef.current = false;

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    controlsRef.current?.stop();
    controlsRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;

    setState((current) => (current.status === "scanning" ? { status: "idle" } : current));
  }

  useEffect(() => stop, []);

  function emit(value: string): void {
    if (pausedRef.current) return;

    const now = performance.now();
    const last = detectedRef.current;
    if (last && last.value === value && now - last.at < DETECTION_DEBOUNCE_MS) return;

    detectedRef.current = { value, at: now };
    onDetectedRef.current(value);
  }

  async function start(): Promise<void> {
    setState({ status: "starting" });

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setState({ status: "unsupported" });
      return;
    }

    try {
      const BarcodeDetector = (
        window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
      ).BarcodeDetector;

      if (BarcodeDetector) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error("video element missing");

        video.srcObject = stream;
        await video.play();

        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        runningRef.current = true;

        const tick = async (): Promise<void> => {
          if (!runningRef.current || !videoRef.current) return;

          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes[0]?.rawValue;
            if (value) emit(value);
          } catch {
            // A single failed frame is normal while the camera focuses.
          }

          if (runningRef.current) {
            frameRef.current = requestAnimationFrame(() => {
              void tick();
            });
          }
        };

        void tick();
        setState({ status: "scanning" });
        return;
      }

      // Dynamic import keeps ZXing out of the initial bundle.
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();

      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current ?? undefined,
        (result) => {
          if (result) emit(result.getText());
        },
      );
      runningRef.current = true;
      setState({ status: "scanning" });
    } catch (error) {
      stop();
      setState(cameraErrorState(error));
    }
  }

  return (
    <section className="space-y-3" aria-label="Pemindai kamera">
      <div className="relative overflow-hidden rounded-xl border bg-black">
        <video
          ref={videoRef}
          className="aspect-[3/4] w-full object-cover sm:aspect-video"
          playsInline
          muted
          autoPlay
        />

        {state.status !== "scanning" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center text-white">
            <Camera aria-hidden="true" className="size-8" />
            <p className="text-sm">
              {state.status === "starting"
                ? "Menyalakan kamera…"
                : "Kamera belum aktif. Tekan tombol mulai untuk memindai kartu peserta."}
            </p>
            {state.status === "starting" ? (
              <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
            ) : (
              <Button type="button" onClick={() => void start()} size="sm">
                <Play aria-hidden="true" className="size-4" />
                Mulai kamera
              </Button>
            )}
          </div>
        )}

        {state.status === "scanning" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="size-56 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
      </div>

      <div aria-live="polite" className="text-sm">
        {state.status === "denied" && (
          <p className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-amber-800">
            Izin kamera ditolak. Buka pengaturan situs di browser, izinkan kamera,
            lalu tekan “Coba lagi”. Anda juga dapat memakai input kode di bawah.
          </p>
        )}

        {state.status === "unavailable" && (
          <p className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-amber-800">
            Kamera tidak ditemukan. Pastikan perangkat memiliki kamera dan tidak
            sedang dipakai aplikasi lain.
          </p>
        )}

        {state.status === "unsupported" && (
          <p className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-amber-800">
            Browser ini tidak mendukung akses kamera. Gunakan Chrome/Safari terbaru,
            atau minta admin mencatat kehadiran secara manual.
          </p>
        )}

        {state.status === "error" && (
          <p className="rounded-lg border border-red-600/30 bg-red-600/5 p-3 text-red-700">
            {state.message}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {state.status === "scanning" ? (
          <Button type="button" variant="outline" size="sm" onClick={stop}>
            <CameraOff aria-hidden="true" className="size-4" />
            Hentikan kamera
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void start()}
            disabled={state.status === "starting"}
          >
            {state.status === "idle" ? (
              <Camera aria-hidden="true" className="size-4" />
            ) : (
              <Play aria-hidden="true" className="size-4" />
            )}
            Coba lagi
          </Button>
        )}
      </div>
    </section>
  );
}
