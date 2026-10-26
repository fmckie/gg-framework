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
  /** When it paired (ISO 8601), as the host's device list names it. */
  created: string;
  lastSeen: string | null;
  revoked: boolean;
  admin: boolean;
}

/** How long a paired device shows as New in the devices lists: a week. */
export const NEW_DEVICE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a device paired recently enough to show as New, so a pairing nobody
 * meant stands out to an admin (each one also pushes an alert to the admins'
 * phones). Never this device itself, and never a revoked one.
 */
export function isNewDevice(device: Device, selfId: string | null, now: number): boolean {
  if (device.revoked || device.deviceId === selfId) return false;
  const created = Date.parse(device.created);
  return !Number.isNaN(created) && now - created < NEW_DEVICE_MS;
}

export interface PairOffer {
  display: string;
  /** Epoch milliseconds (the host's `expiresAt`, passed through by Rust). */
  expiresAt: number;
  admin: boolean;
  /** The link's pairing ticket for this code: what the QR code and the
   *  pairing text carry. `null` from a host without the link, or while its
   *  link can't pair, when `ticketError` says why. */
  ticket: string | null;
  /** Why there's no ticket: "no_link", "link_down", "config" or "ticket".
   *  `null` with a ticket, and from a host from before the link. */
  ticketError: string | null;
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
  /** After `pair`: "active" = switched on in place (iPhone, first pairing);
   *  "restart" = applies on the next launch. */
  activatePairing: () => invoke<"active" | "restart">("kleio_activate_pairing"),
  forget: () => invoke<void>("kleio_forget"),
  devices: () => invoke<Device[]>("kleio_devices"),
  revoke: (deviceId: string) => invoke<Device[]>("kleio_revoke", { deviceId }),
  offer: (admin: boolean) => invoke<PairOffer>("kleio_offer", { admin }),
  adminState: () => invoke<AdminState>("kleio_admin_state"),
  adminLock: () => invoke<void>("kleio_admin_lock"),
  tailscale: () => invoke<TailscaleStatus>("kleio_tailscale_status"),
};

/** One machine on the tailnet (kleio/tailscale.rs). */
export interface TailscaleNode {
  name: string;
  dnsName: string;
  ip: string | null;
  os: string | null;
  online: boolean;
  lastSeen: string | null;
  /** A direct path is up, rather than a relay. */
  direct: boolean;
  relay: string | null;
}

/** This Mac's Tailscale, and the paired Mac mini as a peer on it. */
export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  backendState: string | null;
  tailnet: string | null;
  magicDnsSuffix: string | null;
  version: string | null;
  health: string[];
  self: TailscaleNode | null;
  host: TailscaleNode | null;
  error: string | null;
}

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
  // An admin command's error (Rust `AdminError`) arrives as {kind, message}:
  // its message, rather than "[object Object]".
  if (
    typeof e === "object" &&
    e !== null &&
    !(e instanceof Error) &&
    typeof (e as { message?: unknown }).message === "string"
  ) {
    return (e as { message: string }).message;
  }
  // Tauri delivers a command's Err(String) as-is; a thrown Error stringifies
  // with an "Error: " prefix. Match the marker anywhere so both forms work.
  const s = String(e);
  if (s.includes("denied:unavailable"))
    return "Touch ID isn't available on this Mac, so admin actions are locked.";
  if (s.includes("denied:denied")) return "Touch ID was cancelled or didn't match.";
  return s.replace(/^Error:\s*/, "");
}
