// The link's relay list (kleio-host link-relays.ts), for Settings → Connection
// → Relays. Its own module, as only that page uses it: kleioApi.ts loads with
// the app's first screen.

import { call, KleioApiError } from "./kleioApi";

/** How a relay in the list is, from kleio-link-host's state. */
export type RelayState = "home" | "connecting" | "standby" | "unreachable" | "untested" | "unknown";

const RELAY_STATES: readonly RelayState[] = [
  "home",
  "connecting",
  "standby",
  "unreachable",
  "untested",
  "unknown",
];

/** A relay in the list: `"n0"` (n0's public relays) or `https://<host>/`. */
export interface RelayRow {
  entry: string;
  state: RelayState;
  /** Not in the last list every device had. */
  new: boolean;
}

/** GET /kleio/link/relays: the list, and whether the host uses it yet. */
export interface RelayList {
  listVersion: number;
  relays: RelayRow[];
  /** False while it waits for devices to have it. */
  inUse: boolean;
  /** The relay kleio-link-host is on now, or null. */
  hostRelay: string | null;
  /** How many devices it waits for. */
  waiting: number;
  /** Admins only: which. */
  waitingFor?: { deviceId: string; label: string; lastSeen: string | null }[];
}

/** What a relay being added said to GET /ping. */
export type RelayPing =
  | { relay: string; kind: "relay"; ms: number }
  | { relay: string; kind: "not_a_relay" | "no_answer"; detail: string };

function relayListFrom(body: unknown): RelayList {
  const o = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const rows = Array.isArray(o.relays) ? o.relays : null;
  const ok =
    typeof o.listVersion === "number" &&
    typeof o.inUse === "boolean" &&
    typeof o.waiting === "number" &&
    (o.hostRelay === null || typeof o.hostRelay === "string") &&
    rows !== null &&
    rows.every(
      (r: unknown) =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as RelayRow).entry === "string" &&
        RELAY_STATES.includes((r as RelayRow).state) &&
        typeof (r as RelayRow).new === "boolean",
    );
  if (!ok) throw new KleioApiError(502, "The host's relay list couldn't be read.");
  const waitingFor = Array.isArray(o.waitingFor)
    ? o.waitingFor.flatMap((d: unknown) => {
        const w = typeof d === "object" && d !== null ? (d as Record<string, unknown>) : {};
        return typeof w.deviceId === "string" && typeof w.label === "string"
          ? [
              {
                deviceId: w.deviceId,
                label: w.label,
                lastSeen: typeof w.lastSeen === "string" ? w.lastSeen : null,
              },
            ]
          : [];
      })
    : undefined;
  return {
    listVersion: o.listVersion as number,
    relays: (rows as RelayRow[]).map((r) => ({ entry: r.entry, state: r.state, new: r.new })),
    inUse: o.inUse as boolean,
    hostRelay: o.hostRelay as string | null,
    waiting: o.waiting as number,
    ...(waitingFor ? { waitingFor } : {}),
  };
}

function relayPingsFrom(body: unknown): RelayPing[] {
  const pings = (body as { pings?: unknown } | null)?.pings;
  return Array.isArray(pings)
    ? pings.filter(
        (p: unknown): p is RelayPing =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as RelayPing).relay === "string" &&
          ((p as RelayPing).kind === "relay"
            ? typeof (p as { ms?: unknown }).ms === "number"
            : typeof (p as { detail?: unknown }).detail === "string"),
      )
    : [];
}

/** The link's relay list. Any paired device reads it. */
export const relayList = async (): Promise<RelayList> =>
  relayListFrom(await call<unknown>("GET", "/kleio/link/relays"));

/**
 * Admin devices only: sets the list, changing version `listVersion`. Each
 * relay being added is asked GET /ping first: one that doesn't answer fails
 * with a 422 whose body has the pings, unless `force` saves it anyway.
 */
export const setRelayList = async (
  listVersion: number,
  relays: string[],
  force = false,
): Promise<{ list: RelayList; pings: RelayPing[] }> => {
  const body = await call<unknown>("PUT", "/kleio/link/relays", {
    listVersion,
    relays,
    ...(force ? { force: true } : {}),
  });
  return { list: relayListFrom(body), pings: relayPingsFrom(body) };
};

/** A 422's pings, from a refused `setRelayList`. */
export function refusedPings(e: unknown): RelayPing[] {
  return e instanceof KleioApiError && e.status === 422 ? relayPingsFrom(e.body) : [];
}

/** Admin devices only: the host uses a waiting list now. */
export const adoptRelayList = async (listVersion: number): Promise<RelayList> =>
  relayListFrom(await call<unknown>("POST", "/kleio/link/relays/use-now", { listVersion }));
