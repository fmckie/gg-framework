// Kleio's link, from the webview: pairing with a link ticket, and the link
// card's status (Rust: kleio/link.rs, on macOS and iOS). Windows and Linux
// builds have none of these commands, so their first status call fails: then
// none of the link's UI shows, and the pairing form is exactly what it was.

import { Channel, invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { HostRecord } from "./useKleioRemote";

/** One path event, as the link's log wrote it. */
export interface LinkEvent {
  /** Milliseconds since 1970. */
  atMs: number;
  text: string;
}

/** A relay, as the link names it. */
export interface LinkRelayName {
  /** Its host name. */
  host: string;
  /** One of n0's public relays. */
  n0: boolean;
}

/** Why the latest dial found no host, once the link has looked. */
export interface LinkUnreached {
  /**
   * `host-silent`: a relay answered, the host didn't. `no-relay`: no relay
   * answered. `relay-refused`: the relay turned this version of Kleio away.
   */
  kind: "host-silent" | "no-relay" | "relay-refused";
  /** Every relay tried (`no-relay`), or the one that turned Kleio away. */
  relays: LinkRelayName[];
}

/** `kleio_link_status`: what the link is doing now. Reading it never dials. */
export interface LinkStatus {
  /** A link pairing is saved. */
  paired: boolean;
  /** This launch reaches the host over the link. */
  active: boolean;
  running: boolean;
  /** Why the link couldn't start, if it couldn't. */
  error: string | null;
  host: string | null;
  hostKey: string | null;
  /** The relay the host was last reached through. */
  relay: string | null;
  /** `relay` is one of n0's public relays. */
  relayN0: boolean;
  /** Why the host turned this device away, if it did: not paired, or removed. */
  refused: string | null;
  /** How the host turned this device away, if it did. */
  refusal: "not-paired" | "revoked" | null;
  /** A connection to the host is open now. */
  connected: boolean;
  /** A dial to the host is under way. */
  dialling: boolean;
  /** Why the latest dial found no host, once the link has looked. */
  unreached: LinkUnreached | null;
  /** When bytes last came from the host, in milliseconds since 1970. */
  lastReachedMs: number | null;
  path: "relay" | "direct" | null;
  /** The relay's URL, or the direct path's `ip:port`. */
  pathAddr: string | null;
  /** The open connection goes through one of n0's public relays. */
  pathN0: boolean;
  /**
   * A relay is slowing the open connection: it said so to this device or the
   * host, or a big download through it came slower than 1.5 MB/s.
   */
  rateLimited: boolean;
  rttMs: number | null;
  /** When the open connection came up, in milliseconds since 1970. */
  connectedSinceMs: number | null;
  redials: number;
  /** The latest resume, from coming back on screen to the first byte back. */
  lastResumeMs: number | null;
  /** The latest path events, oldest first. */
  events: LinkEvent[];
  /**
   * A debug build: the iPhone's pairing form also takes pasted pairing text,
   * as the Mac's always does, since the simulator has no camera.
   */
  debugBuild: boolean;
}

/**
 * The step a pairing is on, as it begins (PairStage in packages/kleio-link):
 * its three steps by name, then the wait for an admin's Allow on the host,
 * with this device's code, which the admin is asked about too.
 */
export type PairStage = "relay" | "host" | "pairing" | { waiting: { deviceCode: string } };

/** What the confirm step shows for a link ticket. */
export interface TicketCheck {
  /** The host's name, as the ticket gives it. */
  name: string;
  /** The host key's first 10 characters, as `kleio-host status` shows it. */
  keyPrefix: string;
  /** The pairing relay's host name. */
  relayHost: string;
  /** The pair code, `ABC-DEF`. */
  code: string;
}

/**
 * Where a switch from a pairing by address to the link is (`SwitchView` in
 * kleio/switch.rs):
 * - `none`: no old pairing waiting to go;
 * - `waiting-for-link`: the link pairing hasn't had a good session yet;
 * - `pending`: it has, and the cleanup runs at the next connection;
 * - `waiting-for-host`: the host wasn't reached to drop the old pairing;
 * - `refused`: the host won't drop it (a 401), so it can be removed here;
 * - `unfinished`: the host dropped it, and what's left here is still going.
 */
export interface SwitchStatus {
  state: "none" | "waiting-for-link" | "pending" | "waiting-for-host" | "refused" | "unfinished";
  /** Why, from the last run, for `waiting-for-host`, `refused` and `unfinished`. */
  reason: string | null;
}

export const kleioLink = {
  status: () => invoke<LinkStatus>("kleio_link_status"),
  /** The switch's cleanup: what it's waiting for. */
  switchStatus: () => invoke<SwitchStatus>("kleio_switch_status"),
  /** Removes the old pairing by address here, once the host refused to. */
  removeOld: () => invoke<void>("kleio_switch_remove_old"),
  checkTicket: (ticket: string) => invoke<TicketCheck>("kleio_link_check_ticket", { ticket }),
  /**
   * Pairs and switches the pairing on, as `pair` then `activatePairing` do,
   * telling `onStage` each step as it begins, then the wait for an admin's
   * Allow.
   */
  pair: (ticket: string, label: string, onStage?: (stage: PairStage) => void) =>
    invoke<HostRecord>(
      "kleio_link_pair",
      onStage ? { ticket, label, onStage: new Channel<PairStage>(onStage) } : { ticket, label },
    ),
  /**
   * Stops the pairing under way (Cancel on its wait): `pair` then fails with
   * "Pairing was cancelled." and saves nothing.
   */
  cancelPair: () => invoke<void>("kleio_link_pair_cancel"),
};

/**
 * The link's status: `undefined` until the first answer, `null` when this
 * build has no link (or isn't running in Tauri). With `everyMs` it's read
 * again that often, once the link has answered; a later failed read keeps
 * the last status.
 */
export function useKleioLink(everyMs?: number): {
  link: LinkStatus | null | undefined;
  setLink: (status: LinkStatus) => void;
} {
  const [link, setLink] = useState<LinkStatus | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let answered = false;
    let timer: number | undefined;
    const read = (): void => {
      kleioLink.status().then(
        (status) => {
          answered = true;
          if (alive) setLink(status);
        },
        () => {
          if (answered) return;
          // No link in this build: nothing to read again.
          window.clearInterval(timer);
          if (alive) setLink(null);
        },
      );
    };
    read();
    if (everyMs !== undefined) timer = window.setInterval(read, everyMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [everyMs]);
  return { link, setLink };
}
