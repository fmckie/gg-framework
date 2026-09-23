// What this window knows about the Kleio host. `active` = what this process
// booted against (null in local mode); `paired` = the record on disk, which
// differs from `active` between a pair/forget and the restart that applies it.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface ActiveRemote {
  base: string;
  host: string;
  deviceId: string;
  label: string;
  admin: boolean;
}

export interface HostRecord {
  baseUrl: string;
  host: string;
  deviceId: string;
  label: string;
  admin: boolean;
  pairedAt: string;
}

export interface RemoteStatus {
  active: ActiveRemote | null;
  paired: HostRecord | null;
}

export interface Device {
  deviceId: string;
  label: string;
  createdAt: string;
  lastSeen: string | null;
  revoked: boolean;
  admin: boolean;
}

export interface PairOffer {
  display: string;
  expiresAt: string;
  admin: boolean;
}

export interface AdminState {
  unlocked: boolean;
  expiresAt: number | null;
  available: boolean;
}

export const kleio = {
  status: () => invoke<RemoteStatus>("kleio_remote_status"),
  pair: (baseUrl: string, code: string, label: string) =>
    invoke<HostRecord>("kleio_pair", { baseUrl, code, label }),
  forget: () => invoke<void>("kleio_forget"),
  devices: () => invoke<Device[]>("kleio_devices"),
  revoke: (deviceId: string) => invoke<Device[]>("kleio_revoke", { deviceId }),
  offer: (admin: boolean) => invoke<PairOffer>("kleio_offer", { admin }),
  adminState: () => invoke<AdminState>("kleio_admin_state"),
  adminLock: () => invoke<void>("kleio_admin_lock"),
};

export function useKleioRemote(): { status: RemoteStatus | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await kleio.status());
    } catch {
      // Not in Tauri (vite dev in a browser): behave as local.
      setStatus({ active: null, paired: null });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, refresh };
}

/** "Denied" errors from the Rust gate are `denied:<reason>`; everything else is a message. */
export function explainError(e: unknown): string {
  // Tauri delivers a command's Err(String) as-is; a thrown Error stringifies
  // with an "Error: " prefix. Match the marker anywhere so both forms work.
  const s = String(e);
  if (s.includes("denied:unavailable"))
    return "Touch ID isn't available on this Mac, so admin actions are locked.";
  if (s.includes("denied:denied")) return "Touch ID was cancelled or didn't match.";
  return s.replace(/^Error:\s*/, "");
}
