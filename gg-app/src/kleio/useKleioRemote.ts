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

/** What the host said when Forget host asked it to remove this device
 *  (`kleio_forget`). The pairing is forgotten here whatever it said. */
export type Forgot =
  | { onHost: "removed" }
  | { onHost: "refused" }
  | { onHost: "notRemoved"; reason: string }
  | { onHost: "notPaired" };

/** A pairing by address (`kleio_pair`): its record, and what the host of the
 *  link pairing it set aside said when asked to remove it. `null` when there
 *  was no link pairing. */
export interface Paired extends HostRecord {
  setAside: Forgot | null;
}

export interface AdminState {
  unlocked: boolean;
  expiresAt: number | null;
  available: boolean;
}

/** The device waiting on the live pairing code over the link (`PairClaim`
 *  in commands.rs): the one Pair a device asks the admin to allow. */
export interface PairClaim {
  /** The name it asked to be listed under; `null` if it gave none. */
  label: string | null;
  /** Its device code, "3F9 AC2", which the device shows too. */
  deviceCode: string;
  /** When it first brought the code, in epoch milliseconds. */
  at: number;
  /** Another device has brought the code since. */
  contested: boolean;
  /** An admin allowed it, and it's finishing on the device. */
  allowed: boolean;
}

/** The live pairing code, as the host tells an admin (`kleio_pair_state`). */
export interface PairState {
  active: boolean;
  expiresAt: number | null;
  /** The code has paired a device. */
  redeemed: boolean;
  admin: boolean;
  claim: PairClaim | null;
}

/** The device an admin's Allow or Deny applied to. */
export interface Decided {
  label: string | null;
  deviceCode: string;
}

/** A device paired in the last week, for the "New device paired" notice
 *  (`kleio_recent_pairings`): not revoked, and not this one. */
export interface RecentPairing {
  deviceId: string;
  label: string;
  /** When it paired (ISO 8601). */
  created: string;
  admin: boolean;
}

export const kleio = {
  status: () => invoke<RemoteStatus>("kleio_remote_status"),
  pair: (baseUrl: string, code: string, label: string) =>
    invoke<Paired>("kleio_pair", { baseUrl, code, label }),
  /** After `pair`: "active" = switched on in place (iPhone, first pairing);
   *  "restart" = applies on the next launch. */
  activatePairing: () => invoke<"active" | "restart">("kleio_activate_pairing"),
  forget: () => invoke<Forgot>("kleio_forget"),
  devices: () => invoke<Device[]>("kleio_devices"),
  revoke: (deviceId: string) => invoke<Device[]>("kleio_revoke", { deviceId }),
  offer: (admin: boolean) => invoke<PairOffer>("kleio_offer", { admin }),
  /** Who's waiting on the live pairing code. Touch ID once, then not while
   *  the admin unlock is open. */
  pairState: () => invoke<PairState>("kleio_pair_state"),
  /** Allow or Deny the device waiting with `deviceCode`, and only that one:
   *  an error of kind "changed" if another took its place, "none_waiting" if
   *  none is waiting. */
  decide: (allow: boolean, deviceCode: string) =>
    invoke<Decided>("kleio_pair_decide", { allow, deviceCode }),
  /** Takes the live pairing code away. A device waiting on it is denied. */
  cancelOffer: () => invoke<void>("kleio_pair_cancel"),
  /** The devices paired in the last week, newest first. No Touch ID. */
  recentPairings: () => invoke<RecentPairing[]>("kleio_recent_pairings"),
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
