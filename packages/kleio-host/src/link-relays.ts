// The link's relay list, as admins change it (the plan's Phase 4).
//
// Phones find the host only through the relays they know, with no address
// lookup, and kleio-link-host is on one relay at a time. So a changed list
// reaches devices first, and the host moves only once they have it:
//
// - An admin sets the list (`PUT /kleio/link/relays`): 1 to MAX_RELAYS https
//   relay addresses or "n0", none twice. `listVersion` goes up by one, and
//   each relay is asked `GET /ping` once, to say at once which don't answer.
//   kleio-link-host asks them again itself, and marks each in its state.
// - Devices get the list from GET /kleio/link after each connection, and the
//   host keeps the version each device got (the device registry).
// - Until every device on the link seen in the last WAIT_FOR_MS has the new
//   list, the host's order (link.ts, `hostOrder`) keeps it on relays the last
//   list every device had: the new list's own relays that list has, as the
//   new list orders them, then the relays it drops, then its new ones.
// - Then the new list is used as it is. An admin can say so before that:
//   "Use it now" (`POST /kleio/link/relays/use-now`).
//
// A device that hasn't been seen for WAIT_FOR_MS doesn't hold a list up. If
// the host moved to a relay it doesn't know, it pairs again.

import type { ClientRequest, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { atomicWrite, type PairedDevice } from "./device-registry.js";
import {
  isN0RelayUrl,
  isRelayUrl,
  LINK_CONFIG_FILE,
  MAX_RELAY_URL_LENGTH,
  MAX_RELAYS,
  N0_RELAYS,
  readLinkConfig,
  type LinkConfig,
  type LinkStateRead,
} from "./link.js";
import { err, ok, type Result } from "./result.js";

/** How recently a device must have been seen to hold a new list up. */
export const WAIT_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/** The largest PUT /kleio/link/relays body. */
export const MAX_RELAY_LIST_BODY = 4096;

/** How long a relay gets to answer `GET /ping`. */
export const PING_TIMEOUT_MS = 5_000;

/** The most of a `/ping` answer read. A relay's is empty. */
const PING_MAX_BODY = 1024;

// ------------------------------------------------------------ checking

/** Why `value` isn't a relay list entry, in words, or null if it is one. */
export function relayEntryProblem(value: unknown): string | null {
  if (value === N0_RELAYS) return null;
  if (typeof value !== "string" || value === "") return "isn't an address";
  if (value.length > MAX_RELAY_URL_LENGTH) {
    return `is over ${MAX_RELAY_URL_LENGTH} characters`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "isn't an address";
  }
  if (url.protocol !== "https:") return "isn't https";
  if (url.username !== "" || url.password !== "") return "has a user name or password in it";
  if (url.pathname !== "/") return "has a path after the host";
  if (url.search !== "") return "has a query";
  if (url.hash !== "") return "has a fragment";
  if (!isRelayUrl(value)) return `should be written ${url.href}`;
  return null;
}

/** Why `value` isn't a relay list, in words, or null if it is one. */
export function relayListProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RELAYS) {
    return `A relay list has 1 to ${MAX_RELAYS} relays.`;
  }
  for (const [i, entry] of value.entries()) {
    const problem = relayEntryProblem(entry);
    if (problem !== null) {
      const name = typeof entry === "string" && entry !== "" ? entry : `Relay ${i + 1}`;
      return `${name.slice(0, MAX_RELAY_URL_LENGTH)} ${problem}.`;
    }
  }
  if (new Set(value).size !== value.length) return "A relay is listed twice.";
  return null;
}

// ------------------------------------------------------------ the rule

/**
 * The order kleio-link-host uses while `list` waits: `list`'s relays that
 * `promoted` has, in `list`'s order, then those `list` drops, then its new
 * ones, MAX_RELAYS at most. So the host stays on relays every device knows.
 */
export function hostOrderOf(promoted: readonly string[], list: readonly string[]): string[] {
  const known = list.filter((r) => promoted.includes(r));
  const dropped = promoted.filter((r) => !list.includes(r));
  const added = list.filter((r) => !promoted.includes(r));
  return [...known, ...dropped, ...added].slice(0, MAX_RELAYS);
}

/**
 * The devices a list of version `listVersion` waits for: live ones on the
 * link, seen (or paired) in the last WAIT_FOR_MS, that haven't got it.
 */
export function waitingFor(
  devices: readonly PairedDevice[],
  listVersion: number,
  now: Date,
): PairedDevice[] {
  return devices.filter((d) => {
    if (d.revoked || d.linkKey === null) return false;
    const seen = Date.parse(d.lastSeen ?? d.created);
    if (!Number.isFinite(seen) || now.getTime() - seen > WAIT_FOR_MS) return false;
    return (d.listVersion ?? -1) < listVersion;
  });
}

// ------------------------------------------------------------ the file

/** link/config.json for `config`, as `readLinkConfig` reads it. */
export function linkConfigText(config: LinkConfig): string {
  const doc =
    config.promoted === null
      ? { version: 1, listVersion: config.listVersion, relays: config.relays }
      : {
          version: 1,
          listVersion: config.listVersion,
          relays: config.hostOrder,
          list: config.relays,
          promoted: config.promoted,
        };
  return `${JSON.stringify(doc)}\n`;
}

// ------------------------------------------------------------ asking a relay

/** What a relay said to `GET /ping`. */
export type RelayPing =
  | { readonly kind: "relay"; readonly ms: number }
  | { readonly kind: "not_a_relay"; readonly detail: string }
  | { readonly kind: "no_answer"; readonly detail: string };

/** How `pingRelay` asks: HTTPS, and its time limit. Tests change both. */
export interface PingOptions {
  readonly open?: (url: URL, options: RequestOptions) => ClientRequest;
  readonly timeoutMs?: number;
}

/**
 * Asks `relay` (https://<host>/) `GET /ping` once, as kleio-link-host does:
 * an iroh relay answers 200 with nothing in it. No redirects, PING_TIMEOUT_MS.
 */
export function pingRelay(relay: string, options: PingOptions = {}): Promise<RelayPing> {
  const open = options.open ?? httpsRequest;
  const timeoutMs = options.timeoutMs ?? PING_TIMEOUT_MS;
  const started = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = (ping: RelayPing): void => {
      if (done) return;
      done = true;
      resolve(ping);
    };
    const req = open(new URL("/ping", relay), {
      method: "GET",
      timeout: timeoutMs,
      headers: { accept: "*/*" },
    });
    req.on("response", (res) => {
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > PING_MAX_BODY) res.destroy();
      });
      res.on("end", () => {
        if (res.statusCode === 200 && size === 0) {
          finish({ kind: "relay", ms: Date.now() - started });
        } else {
          const what = res.statusCode === 200 ? "with a body" : `HTTP ${res.statusCode}`;
          finish({ kind: "not_a_relay", detail: `answered ${what}, as a relay doesn't` });
        }
      });
      res.on("close", () =>
        finish({ kind: "not_a_relay", detail: "answered more than a relay does" }),
      );
    });
    req.on("timeout", () => {
      req.destroy();
      finish({ kind: "no_answer", detail: `no answer in ${timeoutMs / 1000} s` });
    });
    req.on("error", (e: NodeJS.ErrnoException) =>
      finish({ kind: "no_answer", detail: e.code ?? e.message }),
    );
    req.end();
  });
}

// ------------------------------------------------------------ the list

/** How a relay in the list is, from kleio-link-host's state. */
export type RelayState = "home" | "connecting" | "standby" | "unreachable" | "untested" | "unknown";

/** A relay in the list, as GET /kleio/link/relays gives it. */
export interface RelayRow {
  readonly entry: string;
  readonly state: RelayState;
  /** Not in the last list every device had: the host doesn't use it first yet. */
  readonly new: boolean;
}

/** A device the list waits for (admins only). */
export interface WaitingDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly lastSeen: string | null;
}

/** GET /kleio/link/relays. */
export interface RelayListStatus {
  readonly listVersion: number;
  readonly relays: readonly RelayRow[];
  /** Whether the host uses the list as it is: nothing waits. */
  readonly inUse: boolean;
  /** The relay the host is on now, or null. */
  readonly hostRelay: string | null;
  /** How many devices the list waits for. */
  readonly waiting: number;
  /** Which ones: admins only. */
  readonly waitingFor?: readonly WaitingDevice[];
}

/** An `n0` entry's or a relay's state, from kleio-link-host's relay board. */
function stateOf(entry: string, read: LinkStateRead): RelayState {
  if (read.kind !== "running") return "unknown";
  const rows = read.state.relays.filter((r) =>
    entry === N0_RELAYS ? isN0RelayUrl(r.url) : r.url === entry,
  );
  for (const state of ["home", "connecting", "standby", "unreachable", "untested"] as const) {
    if (rows.some((r) => r.state === state)) return state;
  }
  return "untested";
}

/** The status of `config`, for `devices`, as kleio-link-host reports it. */
export function relayListStatus(
  config: LinkConfig,
  read: LinkStateRead,
  devices: readonly PairedDevice[],
  now: Date,
  admin: boolean,
): RelayListStatus {
  const waits = config.promoted === null ? [] : waitingFor(devices, config.listVersion, now);
  return {
    listVersion: config.listVersion,
    relays: config.relays.map((entry) => ({
      entry,
      state: stateOf(entry, read),
      new: config.promoted !== null && !config.promoted.includes(entry),
    })),
    inUse: config.promoted === null,
    hostRelay: read.kind === "running" ? read.state.relay : null,
    waiting: waits.length,
    ...(admin
      ? {
          waitingFor: waits.map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            lastSeen: d.lastSeen,
          })),
        }
      : {}),
  };
}

/** Why a change to the list wasn't made. */
export type RelayListError =
  | { readonly kind: "stale"; readonly listVersion: number }
  | { readonly kind: "config"; readonly message: string };

export interface RelayListDeps {
  /** link/. */
  readonly dir: string;
  /** The devices, as the registry has them now. */
  readonly devices: () => readonly PairedDevice[];
  readonly now: () => Date;
  readonly log: (msg: string) => void;
}

export interface RelayList {
  /** The list, as link/config.json has it. */
  read(): Promise<Result<LinkConfig, string>>;
  /**
   * Sets the list, if `expected` is its version now. The host keeps to the
   * relays the last list every device had until they have this one.
   */
  set(expected: number, relays: readonly string[]): Promise<Result<LinkConfig, RelayListError>>;
  /** Uses the list as it is now, if `expected` is its version ("Use it now"). */
  useNow(expected: number): Promise<Result<LinkConfig, RelayListError>>;
  /** Uses the list once no device waits for it: after a device gets it. */
  settle(): Promise<Result<LinkConfig, string>>;
}

export function createRelayList(deps: RelayListDeps): RelayList {
  const path = join(deps.dir, LINK_CONFIG_FILE);
  // One change at a time, so none is lost to another's write.
  let queue: Promise<unknown> = Promise.resolve();
  function serially<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function write(config: LinkConfig): Promise<void> {
    await atomicWrite(path, linkConfigText(config), 0o600);
  }

  /** `config`, used as it is, if nothing waits for it. */
  async function settled(config: LinkConfig): Promise<LinkConfig> {
    if (config.promoted === null) return config;
    if (waitingFor(deps.devices(), config.listVersion, deps.now()).length > 0) return config;
    const used: LinkConfig = { ...config, hostOrder: config.relays, promoted: null };
    await write(used);
    deps.log(
      `[link] every device has relay list ${config.listVersion}; the host uses it now: ${config.relays.join(", ")}`,
    );
    return used;
  }

  return {
    read: () => readLinkConfig(deps.dir),

    set: (expected, relays) =>
      serially(async () => {
        const read = await readLinkConfig(deps.dir);
        if (!read.ok) return err({ kind: "config", message: read.error });
        const now = read.value;
        if (now.listVersion !== expected) {
          return err({ kind: "stale", listVersion: now.listVersion });
        }
        if (relays.length === now.relays.length && relays.every((r, i) => r === now.relays[i])) {
          return ok(now);
        }
        const promoted = now.promoted ?? now.hostOrder;
        const next: LinkConfig = {
          listVersion: now.listVersion + 1,
          relays: [...relays],
          hostOrder: hostOrderOf(promoted, relays),
          promoted: [...promoted],
        };
        try {
          await write(next);
          deps.log(
            `[link] relay list ${next.listVersion}: ${relays.join(", ")}; the host's order until every device has it: ${next.hostOrder.join(", ")}`,
          );
          return ok(await settled(next));
        } catch (e) {
          return err({ kind: "config", message: e instanceof Error ? e.message : String(e) });
        }
      }),

    useNow: (expected) =>
      serially(async () => {
        const read = await readLinkConfig(deps.dir);
        if (!read.ok) return err({ kind: "config", message: read.error });
        const now = read.value;
        if (now.listVersion !== expected) {
          return err({ kind: "stale", listVersion: now.listVersion });
        }
        if (now.promoted === null) return ok(now);
        const used: LinkConfig = { ...now, hostOrder: now.relays, promoted: null };
        try {
          await write(used);
        } catch (e) {
          return err({ kind: "config", message: e instanceof Error ? e.message : String(e) });
        }
        deps.log(
          `[link] an admin uses relay list ${now.listVersion} now: ${now.relays.join(", ")}`,
        );
        return ok(used);
      }),

    settle: () =>
      serially(async () => {
        const read = await readLinkConfig(deps.dir);
        if (!read.ok) return read;
        try {
          return ok(await settled(read.value));
        } catch (e) {
          return err(e instanceof Error ? e.message : String(e));
        }
      }),
  };
}
