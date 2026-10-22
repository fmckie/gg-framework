// The iPhone's pairing QR scanner (4e, "Pairing a device", flow 1), with the
// connection prototype's link (Rust feature `kleio-link-proto`): Tauri's
// barcode-scanner plugin, QR only. A scan only reads the code: what it holds
// goes through `readTicket` like a pasted ticket, and nothing pairs until the
// user presses Pair.
//
// The camera runs behind a see-through webview (`windowed`), so the app draws
// the frame and a Cancel button over it (`ScanOverlay`). The plugin's own
// full-screen view has neither, and would leave no way out but a code.

import {
  Format,
  cancel,
  checkPermissions,
  requestPermissions,
  scan,
} from "@tauri-apps/plugin-barcode-scanner";
import { useEffect, useRef, useState } from "react";

/** How a scan ended. */
export type ScanResult =
  | { kind: "scanned"; text: string }
  /** The user closed the camera. */
  | { kind: "cancelled" }
  /** Camera access is off for Kleio. */
  | { kind: "denied" }
  | { kind: "failed"; error: string };

/** What a denied scan says, with how to turn the camera back on. */
export const CAMERA_DENIED =
  "Kleio can't use the camera. To scan, turn on Camera for Kleio in Settings, or type the details instead.";

function message(e: unknown): string {
  return String(e).replace(/^Error:\s*/, "");
}

/** Asks for the camera if it hasn't been asked yet, then scans one QR code. */
export async function scanPairingQr(): Promise<ScanResult> {
  try {
    // Ask only if iOS hasn't asked yet; after a "no", only Settings can change it.
    const state = await checkPermissions();
    const allowed =
      state === "granted" || (state !== "denied" && (await requestPermissions()) === "granted");
    if (!allowed) return { kind: "denied" };
    const scanned = await scan({ formats: [Format.QRCode], windowed: true });
    return { kind: "scanned", text: scanned.content };
  } catch (e) {
    const text = message(e);
    if (text === "cancelled") return { kind: "cancelled" };
    if (text.includes("denied")) return { kind: "denied" };
    return { kind: "failed", error: `Couldn't scan: ${text}` };
  }
}

/** Stops a running scan; it then ends as cancelled. */
export function cancelScan(): void {
  void cancel().catch(() => {});
}

/**
 * Whether a scan is running, and starting one. A scan still running when
 * the form goes away is cancelled, so the camera never outlives it.
 */
export function usePairingScan(onScanned: (text: string) => void): {
  scanning: boolean;
  error: string | null;
  start: () => Promise<void>;
} {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  useEffect(
    () => () => {
      if (running.current) cancelScan();
    },
    [],
  );
  async function start(): Promise<void> {
    setError(null);
    setScanning(true);
    running.current = true;
    try {
      const result = await scanPairingQr();
      if (result.kind === "scanned") onScanned(result.text);
      else if (result.kind === "denied") setError(CAMERA_DENIED);
      else if (result.kind === "failed") setError(result.error);
    } finally {
      running.current = false;
      setScanning(false);
    }
  }
  return { scanning, error, start };
}
