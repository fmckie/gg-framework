// Kleio's link, kleio-host's side (docs/adr/0002-kleio-link-replaces-tailscale.md).
//
// kleio-link-host, a program of its own beside kleio-host, serves the link:
// it takes each phone's connection (iroh: end-to-end encrypted, the phone's
// key proved in the handshake) and forwards each of its streams here, to the
// link listener on 127.0.0.1:8445. This module has:
//
// - The link listener. Each connection opens with one line, written by
//   kleio-link-host before any of the phone's bytes:
//
//       KLEIO-LINK/1 <the device's key: 64 hex> <secure/link-upstream.token>\r\n
//
//   The secret is compared in constant time. A line that's garbled, longer
//   than 256 bytes, unfinished after 5 s or with the wrong secret closes the
//   connection before anything else is read. The rest of the connection goes
//   to the host's HTTP server, and `keyOf` gives its requests the device's
//   key.
// - The binding check: a device token is good on the link only from the key
//   its device paired with, and off the link only for a device without one.
// - `buildTicket`: the v4 pairing ticket a QR code carries.
// - `readLinkInfo`: GET /kleio/link's answer, what a paired device needs to
//   find the host again.
//
// Two files in link/ (paths.ts) say where the link is:
//
//   state.json   kleio-link-host's: rewritten whenever anything in it
//                changes, and at least every 30 s, so one more than 90 s old
//                means it isn't running.
//                {"version":1,"updatedAt":"<ISO 8601>","pid":1234,
//                 "key":"<64 hex>","relay":"https://<relay>/" or null,
//                 "addrs":["192.0.2.1:7842","[2001:db8::1]:7842"],
//                 "rateLimited":false,"connections":0,
//                 "peers":[{"key":"<64 hex>","path":"direct","at":"<ISO 8601>"}],
//                 "relays":[{"url":"https://<relay>/","state":"…"}]}
//                `relay` is the relay it's on now, `addrs` its direct
//                addresses, best first, `peers` the path each device's
//                connection last took ("direct" or "relay"), latest first,
//                and `relays` each relay's health.
//   config.json  kleio-host's: the relay list, in order, where "n0" stands
//                for n0's public relays. Without the file, n0's alone.
//                {"version":1,"listVersion":0,"relays":["n0"]}
//                `relays` is the order kleio-link-host uses. While a new
//                list waits for every device to have it (link-relays.ts),
//                `list` is that list and `promoted` the last one every
//                device had, and `relays` keeps the host on relays they know:
//                {"version":1,"listVersion":1,"relays":["n0","https://<relay>/"],
//                 "list":["https://<relay>/"],"promoted":["n0"]}

import { createHash, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import { createServer as createNetServer, isIPv4, isIPv6, type Socket } from "node:net";
import { join } from "node:path";
import { isLinkKey, type PairedDevice } from "./device-registry.js";
import { formatPairCode, normalizePairCode } from "./pair-code.js";
import { err, ok, type Result } from "./result.js";

/** The link listener's port on 127.0.0.1 (KLEIO_LINK_PORT). */
export const DEFAULT_LINK_PORT = 8445;

/**
 * The host the app names in link requests: `http://link.kleio.invalid`.
 * `.invalid` never resolves, so it can't be taken for a real address.
 */
export const LINK_HOST = "link.kleio.invalid";

/** The longest first line, `\r\n` included. A real one is 123 bytes. */
export const PREAMBLE_MAX_BYTES = 256;

/** How long a connection has to send its first line. */
export const PREAMBLE_TIMEOUT_MS = 5_000;

/** kleio-link-host's state file in link/. */
export const LINK_STATE_FILE = "state.json";

/** The relay list in link/. */
export const LINK_CONFIG_FILE = "config.json";

/** A state file older than this means kleio-link-host isn't running. */
export const LINK_STATE_FRESH_MS = 90_000;

/** n0's public relays, in a relay list and a ticket: the app has their addresses. */
export const N0_RELAYS = "n0";

/** The most relays in a list, and in a ticket. */
export const MAX_RELAYS = 4;

/** The longest relay address taken. n0's are 35 characters. */
export const MAX_RELAY_URL_LENGTH = 200;

/** The pairing ticket's version and type (v2 is the Tailscale one, pairTicket.ts in the app). */
export const TICKET_VERSION = 4;
export const TICKET_TYPE = "kleio-pair";

/** The longest ticket. The default one is under 300 bytes, for an 80-column terminal's QR code. */
export const MAX_TICKET_BYTES = 512;

/** Direct addresses in a ticket. */
export const MAX_TICKET_ADDRS = 2;

/** Direct addresses in GET /kleio/link. */
export const MAX_INFO_ADDRS = 8;

/** The longest host name in a ticket, in UTF-8 bytes. */
export const MAX_NAME_BYTES = 32;

/** What a host with no usable name is called in a ticket. */
export const FALLBACK_NAME = "Kleio host";

/** The largest state or config file read. */
const MAX_FILE_BYTES = 64 * 1024;

/** A key's short form: its first 10 hex characters, as iroh's `fmt_short` and kleio-link-host's log write it. */
export const KEY_PREFIX_LENGTH = 10;

export function keyPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX_LENGTH);
}

/** The link, as the host is started with it (cli.ts). */
export interface LinkOptions {
  /** The link listener's port on 127.0.0.1; 0 takes any free one (tests). */
  readonly port: number;
  /** secure/link-upstream.token: the secret each connection opens with. */
  readonly upstreamToken: string;
  /** The host's key on the link: secure/link.key's public half, 64 hex. */
  readonly publicKey: string;
  /** link/, with kleio-link-host's state.json and the relay list's config.json. */
  readonly dir: string;
  /** This host's name in pairing tickets (`ticketName`). */
  readonly name: string;
  /** How long a connection has to send its first line (ms). Default PREAMBLE_TIMEOUT_MS. */
  readonly preambleTimeoutMs?: number;
}

// ------------------------------------------------------------ the listener

/** Why the link listener closed a connection before it reached the host. */
export type PreambleRefusal = "garbled" | "too_long" | "slow" | "wrong_secret" | "closed";

const PREAMBLE = /^KLEIO-LINK\/1 ([0-9a-f]{64}) ([A-Za-z0-9_-]{16,128})\r\n$/;

/** What an upstream token looks like, as `newUpstreamToken` makes one. */
export function isUpstreamToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

/**
 * The device key `line` names, if it's a first line with the right secret.
 * `line` runs to its `\n`. A line that's garbled says nothing about the
 * secret, and the secret is compared in constant time.
 */
export function checkPreamble(
  line: Buffer,
  upstreamToken: string,
): Result<string, "garbled" | "wrong_secret"> {
  // latin1 maps each byte to one character, so nothing is decoded away.
  const match = PREAMBLE.exec(line.toString("latin1"));
  const key = match?.[1];
  const secret = match?.[2];
  if (key === undefined || secret === undefined) return err("garbled");
  return sameSecret(secret, upstreamToken) ? ok(key) : err("wrong_secret");
}

/** Constant time whatever the lengths: compares the two secrets' SHA-256 digests. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function refusalText(why: PreambleRefusal, timeoutMs: number): string {
  switch (why) {
    case "garbled":
      return "its first line wasn't a link preamble";
    case "too_long":
      return `its first line was longer than ${PREAMBLE_MAX_BYTES} bytes`;
    case "slow":
      return `its first line wasn't done within ${timeoutMs} ms`;
    case "wrong_secret":
      return "its first line had the wrong secret";
    case "closed":
      return "it closed before its first line was done";
  }
}

export interface LinkListenerOptions {
  /** The host's HTTP server, which gets each connection once its first line checks out. */
  readonly http: HttpServer;
  readonly upstreamToken: string;
  readonly log: (msg: string) => void;
  /** Default PREAMBLE_TIMEOUT_MS. */
  readonly preambleTimeoutMs?: number;
}

export interface LinkListener {
  /** Listens on 127.0.0.1:`port`, and gives the port it got. */
  listen(port: number): Promise<number>;
  /** The port it listens on; null before `listen`. */
  port(): number | null;
  /** The device key a connection came with; null for one that didn't come through here. */
  keyOf(socket: Socket): string | null;
  /** Stops listening, and closes the connections still on their first line. */
  close(): Promise<void>;
}

/**
 * The link listener. A connection goes to `http` with its first line taken
 * off, so the HTTP server sees only the phone's bytes. Connections go to the
 * host's own server, not one of their own, so they get its timeouts, and
 * `closeAllConnections` closes them with the rest.
 */
export function createLinkListener(options: LinkListenerOptions): LinkListener {
  const { http, upstreamToken, log } = options;
  const timeoutMs = options.preambleTimeoutMs ?? PREAMBLE_TIMEOUT_MS;
  const keys = new WeakMap<Socket, string>();
  const opening = new Set<Socket>();
  // Half-open as the HTTP server's own listener is: the HTTP server decides
  // what a client's half-close means.
  const server = createNetServer({ allowHalfOpen: true, noDelay: true }, accept);
  let bound: number | null = null;

  function accept(socket: Socket): void {
    opening.add(socket);
    let head: Buffer = Buffer.alloc(0);
    const timer = setTimeout(() => refuse("slow"), timeoutMs);
    const onEnd = (): void => refuse("closed");
    const onError = (): void => refuse("closed");
    const done = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
      opening.delete(socket);
    };
    function refuse(why: PreambleRefusal): void {
      done();
      log(`[link] closed a connection on the link listener: ${refusalText(why, timeoutMs)}`);
      socket.destroy();
    }
    function onData(chunk: Buffer): void {
      head = head.length === 0 ? chunk : Buffer.concat([head, chunk]);
      const end = head.subarray(0, PREAMBLE_MAX_BYTES).indexOf(0x0a);
      if (end === -1) {
        if (head.length >= PREAMBLE_MAX_BYTES) refuse("too_long");
        return;
      }
      const checked = checkPreamble(head.subarray(0, end + 1), upstreamToken);
      if (!checked.ok) {
        refuse(checked.error);
        return;
      }
      done();
      keys.set(socket, checked.value);
      socket.pause();
      const rest = head.subarray(end + 1);
      if (rest.length > 0) socket.unshift(rest);
      http.emit("connection", socket);
      // The HTTP server reads straight from the socket's handle from here on,
      // so what was put back must reach it first: resuming hands it over on
      // the next tick, before the socket can read anything more.
      socket.resume();
    }
    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
  }

  return {
    listen: (port) =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          server.on("error", (e) => log(`[link] link listener: ${String(e)}`));
          const address = server.address();
          bound = typeof address === "object" && address !== null ? address.port : port;
          resolve(bound);
        });
      }),
    port: () => bound,
    keyOf: (socket) => keys.get(socket) ?? null,
    close: () =>
      new Promise((resolve) => {
        for (const socket of opening) socket.destroy();
        opening.clear();
        if (!server.listening) {
          resolve();
          return;
        }
        // Resolves once the connections the HTTP server has are gone too:
        // the host's stop closes those.
        server.close(() => resolve());
      }),
  };
}

/**
 * Whether `device`'s token may be used on a connection from `linkKey`: on
 * the link (`linkKey` set) only from the key the device paired with, and
 * off it (null) only for a device that has no key. So a link device's token
 * is no use without its key, wherever it's tried.
 */
export function bindingAllows(device: PairedDevice, linkKey: string | null): boolean {
  return device.linkKey === linkKey;
}

// ------------------------------------------------------------ addresses

/**
 * A relay's address as the link takes one: `https://<host>[:<port>]/` and
 * nothing else, written exactly as a URL parser writes it, so the relay a
 * person is shown is the one dialled.
 */
export function isRelayUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_RELAY_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.href === value
  );
}

/** An entry of a relay list: a relay's address, or "n0" for n0's. */
export function isRelayEntry(value: unknown): value is string {
  return value === N0_RELAYS || isRelayUrl(value);
}

/** 1 to MAX_RELAYS entries, none twice. */
export function isRelayList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_RELAYS &&
    value.every(isRelayEntry) &&
    new Set(value).size === value.length
  );
}

const IPV4_ADDR = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;
const IPV6_ADDR = /^\[([0-9a-f:.]+)\]:(\d{1,5})$/;

/**
 * A direct address as Rust writes one (`192.0.2.1:7842`, `[2001:db8::1]:7842`),
 * in that one form, and one a phone could use: not loopback or unspecified.
 */
export function isDirectAddr(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v4 = IPV4_ADDR.exec(value);
  const v6 = v4 ? null : IPV6_ADDR.exec(value);
  const ip = v4?.[1] ?? v6?.[1];
  const port = v4?.[2] ?? v6?.[2];
  if (ip === undefined || port === undefined) return false;
  const portNumber = Number(port);
  if (String(portNumber) !== port || portNumber < 1 || portNumber > 65535) return false;
  if (v4) {
    const octets = ip.split(".");
    return (
      isIPv4(ip) &&
      octets.every((o) => String(Number(o)) === o) &&
      octets[0] !== "0" &&
      octets[0] !== "127"
    );
  }
  if (!isIPv6(ip)) return false;
  let canonical: string;
  try {
    canonical = new URL(`http://[${ip}]/`).hostname;
  } catch {
    return false;
  }
  return canonical === `[${ip}]` && ip !== "::" && ip !== "::1";
}

/**
 * A host name fit for a ticket: control and format characters (bidi
 * overrides among them) and lone surrogates gone, spaces collapsed, cut to
 * MAX_NAME_BYTES at a character's edge. FALLBACK_NAME if nothing's left.
 */
export function ticketName(raw: string): string {
  const cleaned = raw
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  let out = "";
  let bytes = 0;
  for (const ch of cleaned) {
    const point = ch.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > MAX_NAME_BYTES) break;
    out += ch;
    bytes += size;
  }
  return out.trim() || FALLBACK_NAME;
}

// ------------------------------------------------------------ tickets

export interface TicketInput {
  /** This host's name, as `ticketName` gives it. */
  readonly name: string;
  /** The host's key on the link, 64 hex. */
  readonly key: string;
  /** The relay the host is on now: the phone pairs through this one. */
  readonly relay: string;
  /** The host's relay list, in order. */
  readonly relays: readonly string[];
  /** The host's direct addresses, best first. */
  readonly addrs: readonly string[];
  /** The pair code, in any form `normalizePairCode` takes. */
  readonly code: string;
}

export type TicketError = "name" | "key" | "relay" | "relays" | "addrs" | "code" | "too_long";

/**
 * The v4 pairing ticket:
 *
 *   {"v":4,"type":"kleio-pair","name":"mac-mini-1","key":"<64 hex>",
 *    "relays":["https://euc1-1.relay.n0.iroh.link./","n0"],
 *    "addrs":["192.168.1.20:7842"],"code":"ABC-DEF"}
 *
 * `relays` starts with the relay the host is on now, which pairing uses, and
 * goes on with the host's list, up to MAX_RELAYS. `addrs` has up to two
 * direct addresses. Like v2 and v3, it never carries a token. One that would
 * be over MAX_TICKET_BYTES loses addresses, then relays after the first.
 */
export function buildTicket(input: TicketInput): Result<string, TicketError> {
  if (ticketName(input.name) !== input.name) return err("name");
  if (!isLinkKey(input.key)) return err("key");
  if (!isRelayUrl(input.relay)) return err("relay");
  if (!input.relays.every(isRelayEntry)) return err("relays");
  if (!input.addrs.every(isDirectAddr)) return err("addrs");
  const code = normalizePairCode(input.code);
  if (code === null) return err("code");
  let relays = [...new Set([input.relay, ...input.relays])].slice(0, MAX_RELAYS);
  let addrs = [...new Set(input.addrs)].slice(0, MAX_TICKET_ADDRS);
  for (;;) {
    const ticket = JSON.stringify({
      v: TICKET_VERSION,
      type: TICKET_TYPE,
      name: input.name,
      key: input.key,
      relays,
      addrs,
      code: formatPairCode(code),
    });
    if (Buffer.byteLength(ticket, "utf8") <= MAX_TICKET_BYTES) return ok(ticket);
    if (addrs.length > 0) addrs = addrs.slice(0, -1);
    else if (relays.length > 1) relays = relays.slice(0, -1);
    else return err("too_long");
  }
}

// ------------------------------------------------------------ link/ files

/** One relay's health, as kleio-link-host reports it. */
export interface RelayHealth {
  readonly url: string;
  readonly state: string;
}

/** The path a device's connection last took, and when. */
export interface LinkPeer {
  readonly key: string;
  readonly path: "direct" | "relay";
  readonly at: string;
}

/** The most peers read from a state file. */
export const MAX_PEERS = 64;

/** kleio-link-host's state.json, checked. */
export interface LinkState {
  readonly updatedAt: string;
  readonly pid: number;
  readonly key: string;
  /** The relay it's on now; null while it's on none. */
  readonly relay: string | null;
  /** Its direct addresses a phone could use, best first. */
  readonly addrs: readonly string[];
  readonly rateLimited: boolean;
  readonly connections: number;
  readonly relays: readonly RelayHealth[];
  readonly peers: readonly LinkPeer[];
}

export type LinkStateRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "running" | "stale"; readonly state: LinkState };

/** The relay list in link/config.json. */
export interface LinkConfig {
  /** Goes up by one each time the list changes; 0 for the list without the file. */
  readonly listVersion: number;
  /** The list, as devices get it: GET /kleio/link and pairing tickets. */
  readonly relays: readonly string[];
  /** The order kleio-link-host uses: the file's `relays`. */
  readonly hostOrder: readonly string[];
  /**
   * While `relays` waits for every device to have it, the last list every
   * device had; null once `relays` is in use (link-relays.ts).
   */
  readonly promoted: readonly string[] | null;
}

/** The list without link/config.json: n0's relays alone. */
export const DEFAULT_LINK_CONFIG: LinkConfig = {
  listVersion: 0,
  relays: [N0_RELAYS],
  hostOrder: [N0_RELAYS],
  promoted: null,
};

/** Whether `relay` is one of n0's public relays. */
export function isN0RelayUrl(relay: string): boolean {
  const host = new URL(relay).hostname;
  return host.endsWith(".relay.n0.iroh.link.") || host.endsWith(".relay.n0.iroh.link");
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isCount(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}

/** A small JSON file's content: null when it's missing. */
async function readJsonFile(path: string): Promise<Result<unknown, string> | null> {
  let text: string;
  try {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_FILE_BYTES) return err(`${path} is over ${MAX_FILE_BYTES} bytes`);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    return err(`${path} can't be read (${code ?? String(e)})`);
  }
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    return err(`${path} isn't JSON`);
  }
}

/**
 * kleio-link-host's state, if it has written any. Unknown fields are left
 * for later versions; a state file naming a key other than `hostKey` is
 * invalid, since it isn't this host's link.
 */
export async function readLinkState(
  dir: string,
  hostKey: string,
  now: Date,
): Promise<LinkStateRead> {
  const path = join(dir, LINK_STATE_FILE);
  const read = await readJsonFile(path);
  if (read === null) return { kind: "missing" };
  if (!read.ok) return { kind: "invalid", message: read.error };
  const doc = read.value;
  const invalid = (why: string): LinkStateRead => ({ kind: "invalid", message: `${path}: ${why}` });
  if (!isRecord(doc) || doc.version !== 1) return invalid("not a version 1 state file");
  const { updatedAt, pid, key, relay, addrs, rateLimited, connections, relays, peers } = doc;
  const at = typeof updatedAt === "string" ? Date.parse(updatedAt) : Number.NaN;
  if (typeof updatedAt !== "string" || Number.isNaN(at)) return invalid("no updatedAt time");
  if (!isCount(pid) || pid === 0) return invalid("no pid");
  if (key !== hostKey) return invalid("it names another key than secure/link.key's");
  if (relay !== null && !isRelayUrl(relay)) return invalid("relay isn't a relay's address");
  if (!Array.isArray(addrs)) return invalid("addrs isn't a list");
  if (typeof rateLimited !== "boolean") return invalid("rateLimited isn't true or false");
  if (!isCount(connections)) return invalid("connections isn't a count");
  if (relays !== undefined && !Array.isArray(relays)) return invalid("relays isn't a list");
  if (peers !== undefined && !Array.isArray(peers)) return invalid("peers isn't a list");
  const state: LinkState = {
    updatedAt,
    pid,
    key,
    relay,
    // Addresses a phone couldn't use, or in another form, are left out.
    addrs: [...new Set(addrs.filter(isDirectAddr))],
    rateLimited,
    connections,
    relays: (relays ?? []).flatMap((r: unknown) =>
      isRecord(r) && isRelayUrl(r.url) && typeof r.state === "string"
        ? [{ url: r.url, state: r.state }]
        : [],
    ),
    peers: (peers ?? [])
      .flatMap((p: unknown): LinkPeer[] =>
        isRecord(p) &&
        isLinkKey(p.key) &&
        (p.path === "direct" || p.path === "relay") &&
        typeof p.at === "string" &&
        !Number.isNaN(Date.parse(p.at))
          ? [{ key: p.key, path: p.path, at: p.at }]
          : [],
      )
      .slice(0, MAX_PEERS),
  };
  const fresh = Math.abs(now.getTime() - at) <= LINK_STATE_FRESH_MS;
  return { kind: fresh ? "running" : "stale", state };
}

/** The relay list: DEFAULT_LINK_CONFIG without the file, and an error for one that's wrong. */
export async function readLinkConfig(dir: string): Promise<Result<LinkConfig, string>> {
  const path = join(dir, LINK_CONFIG_FILE);
  const read = await readJsonFile(path);
  if (read === null) return ok(DEFAULT_LINK_CONFIG);
  if (!read.ok) return read;
  const doc = read.value;
  if (!isRecord(doc) || doc.version !== 1) return err(`${path}: not a version 1 relay list`);
  if (!isCount(doc.listVersion)) return err(`${path}: listVersion isn't a count`);
  const lists = ["relays", "list", "promoted"] as const;
  for (const name of lists) {
    if ((name === "relays" || doc[name] !== undefined) && !isRelayList(doc[name])) {
      return err(
        `${path}: ${name} must be 1 to ${MAX_RELAYS} relay addresses (https://<host>/) or "n0", none twice`,
      );
    }
  }
  if ((doc.list === undefined) !== (doc.promoted === undefined)) {
    return err(`${path}: list and promoted come together`);
  }
  const hostOrder = [...(doc.relays as string[])];
  return ok({
    listVersion: doc.listVersion,
    relays: isRelayList(doc.list) ? [...doc.list] : hostOrder,
    hostOrder,
    promoted: isRelayList(doc.promoted) ? [...doc.promoted] : null,
  });
}

/** GET /kleio/link: what a paired device keeps, to find the host again. */
export interface LinkInfo {
  /** The host's key. */
  readonly key: string;
  /** The host's relay list, in order. */
  readonly relays: readonly string[];
  readonly listVersion: number;
  /** Whether kleio-link-host's state is current. */
  readonly running: boolean;
  /** The relay the host was last on; null if none is known. */
  readonly relay: string | null;
  /** Its last direct addresses, best first. */
  readonly addrs: readonly string[];
  /** Whether a relay is slowing it down now. */
  readonly rateLimited: boolean;
  /** When kleio-link-host last wrote its state; null if it never has. */
  readonly updatedAt: string | null;
}

export async function readLinkInfo(
  link: Pick<LinkOptions, "dir" | "publicKey">,
  now: Date,
  log: (msg: string) => void,
): Promise<Result<LinkInfo, string>> {
  const config = await readLinkConfig(link.dir);
  if (!config.ok) return config;
  const read = await readLinkState(link.dir, link.publicKey, now);
  if (read.kind === "invalid") log(`[link] ${read.message}; answering without it`);
  const state = read.kind === "running" || read.kind === "stale" ? read.state : null;
  return ok({
    key: link.publicKey,
    relays: config.value.relays,
    listVersion: config.value.listVersion,
    running: read.kind === "running",
    relay: state?.relay ?? null,
    addrs: state?.addrs.slice(0, MAX_INFO_ADDRS) ?? [],
    rateLimited: read.kind === "running" && state !== null && state.rateLimited,
    updatedAt: state?.updatedAt ?? null,
  });
}

/** Why there's no ticket. */
export type LinkTicketError =
  | { readonly kind: "link_down"; readonly message: string }
  | { readonly kind: "config"; readonly message: string }
  | { readonly kind: "ticket"; readonly error: TicketError };

/**
 * The ticket for pair code `code`, from the link as it is now. None while
 * kleio-link-host isn't running or is on no relay: a phone couldn't pair.
 */
export async function linkTicket(
  link: Pick<LinkOptions, "dir" | "publicKey" | "name">,
  code: string,
  now: Date,
): Promise<Result<string, LinkTicketError>> {
  const config = await readLinkConfig(link.dir);
  if (!config.ok) return err({ kind: "config", message: config.error });
  const read = await readLinkState(link.dir, link.publicKey, now);
  if (read.kind === "invalid") return err({ kind: "link_down", message: read.message });
  if (read.kind === "missing") {
    return err({ kind: "link_down", message: "kleio-link-host hasn't written its state" });
  }
  if (read.kind === "stale") {
    return err({
      kind: "link_down",
      message: `kleio-link-host's state is from ${read.state.updatedAt}; it isn't running`,
    });
  }
  if (read.state.relay === null) {
    return err({ kind: "link_down", message: "kleio-link-host isn't on a relay" });
  }
  const ticket = buildTicket({
    name: link.name,
    key: link.publicKey,
    relay: read.state.relay,
    relays: config.value.relays,
    addrs: read.state.addrs,
    code,
  });
  return ticket.ok ? ticket : err({ kind: "ticket", error: ticket.error });
}
