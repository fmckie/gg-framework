// Kleio's link, from the webview: pairing with a link ticket, and the Link
// card's status and switch (Rust: kleio/link.rs, behind the `kleio-link`
// feature). A build without the feature has none of
// these commands, so its first status call fails: then none of the link's UI
// shows, and the pairing form is exactly what it was.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { HostRecord } from "./useKleioRemote";

/** Through the relay at first then direct, or through the relay only. */
export type LinkMode = "auto" | "relayOnly";

/** One path event, as the link's log wrote it. */
export interface LinkEvent {
  /** Milliseconds since 1970. */
  atMs: number;
  text: string;
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
  mode: LinkMode | null;
  host: string | null;
  hostKey: string | null;
  /** The relay the host was last reached through. */
  relay: string | null;
  /** Why the host turned this device away, if it did: not paired, or removed. */
  refused: string | null;
  /** A connection to the host is open now. */
  connected: boolean;
  path: "relay" | "direct" | null;
  /** The relay's URL, or the direct path's `ip:port`. */
  pathAddr: string | null;
  /** The direct path is to a Tailscale address: a field run on it doesn't count. */
  tailscale: boolean;
  rttMs: number | null;
  /** When the open connection came up, in milliseconds since 1970. */
  connectedSinceMs: number | null;
  redials: number;
  /** The latest resume, from coming back on screen to the first byte back. */
  lastResumeMs: number | null;
  /** The latest path events, oldest first. */
  events: LinkEvent[];
  /** The pairing form also takes a pasted ticket (debug builds). */
  debugBuild: boolean;
}

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

export const kleioLink = {
  status: () => invoke<LinkStatus>("kleio_link_status"),
  checkTicket: (ticket: string) => invoke<TicketCheck>("kleio_link_check_ticket", { ticket }),
  /** Pairs and switches the pairing on, as `pair` then `activatePairing` do. */
  pair: (ticket: string, label: string) => invoke<HostRecord>("kleio_link_pair", { ticket, label }),
  setMode: (mode: LinkMode) => invoke<LinkStatus>("kleio_link_set_mode", { mode }),
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
