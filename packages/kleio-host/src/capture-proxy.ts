// A SOCKS5 proxy for one page capture (capture.ts). Every connection the
// capture helper's web view makes (the page, its redirects, images, scripts,
// fetches and WebSockets) goes through it, and each one is judged by
// net-guard.ts's address policy, the same as the host's own fetches.
//
//   - It listens on 127.0.0.1 only, on a port of its own, and asks for a user
//     name and password made for this capture alone (RFC 1929).
//   - CONNECT only: BIND and UDP ASSOCIATE are refused, so nothing but TCP
//     leaves through it.
//   - A name is resolved here, once, every address it has must be public, and
//     the tunnel goes to the address that was checked. A literal address must
//     be public. Ports 80, 443 and 1024 and up only, so a page can't speak to
//     mail, file-sharing or other low-port services through the host.
//   - It closes, with every tunnel through it, when the capture ends.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Socket } from "node:net";
import {
  checkHostname,
  connectPinned,
  resolvePublic,
  systemLookup,
  type Connector,
  type GuardRefusal,
  type HostTarget,
  type LookupAll,
  type PinnedAddress,
} from "./net-guard.js";
import { err, type Result } from "./result.js";

/** How long a client has to finish the SOCKS handshake. */
export const HANDSHAKE_TIMEOUT_MS = 5_000;
/** How long a tunnel's connection may take to open. */
export const CONNECT_TIMEOUT_MS = 10_000;
/** Tunnels open at once. */
export const MAX_TUNNELS = 64;
/** Refusals remembered for the capture's report. */
const MAX_REFUSALS = 50;

const SOCKS_VERSION = 5;
const AUTH_VERSION = 1;
const METHOD_USER_PASSWORD = 0x02;
const NO_ACCEPTABLE_METHOD = 0xff;
const CMD_CONNECT = 1;
const ATYP_IPV4 = 1;
const ATYP_DOMAIN = 3;
const ATYP_IPV6 = 4;

/** SOCKS5 reply codes (RFC 1928 §6). */
const REPLY = {
  succeeded: 0x00,
  failure: 0x01,
  notAllowed: 0x02,
  hostUnreachable: 0x04,
  refused: 0x05,
  commandNotSupported: 0x07,
  addressNotSupported: 0x08,
} as const;

/** A target the proxy turned down, by host name or address only. */
export interface ProxyRefusal {
  readonly host: string;
  readonly why: GuardRefusal | "command" | "busy";
}

export interface CaptureProxy {
  readonly port: number;
  readonly username: string;
  readonly password: string;
  /** Targets refused so far (the first MAX_REFUSALS). */
  refusals(): readonly ProxyRefusal[];
  /** Stops listening and closes every tunnel. */
  close(): Promise<void>;
}

export interface ProxyOptions {
  readonly lookup?: LookupAll;
  readonly connect?: Connector;
  readonly handshakeTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly maxTunnels?: number;
}

/** What a CONNECT asks for, as the client sent it. */
export type SocksTarget =
  | { readonly kind: "address"; readonly address: string; readonly family: 4 | 6 }
  | { readonly kind: "domain"; readonly name: string };

interface Request {
  readonly command: number;
  readonly target: SocksTarget;
  readonly port: number;
}

/** Bytes a client may send ahead of its tunnel before it is cut off. */
const MAX_EARLY_BYTES = 64 * 1024;

/** The handshake, read in exact sizes as the bytes arrive. */
interface HandshakeReader {
  /** The next `n` bytes, or null once the client has gone. */
  take(n: number): Promise<Buffer | null>;
  /** Stops reading (the client is paused) and returns what came after the handshake. */
  release(): Buffer;
}

function handshakeReader(socket: Socket): HandshakeReader {
  let buffered = Buffer.alloc(0);
  let gone = false;
  let waiter: (() => void) | null = null;
  const wake = (): void => {
    const resume = waiter;
    waiter = null;
    resume?.();
  };
  const onData = (chunk: Buffer): void => {
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.length > MAX_EARLY_BYTES) socket.destroy();
    wake();
  };
  const onGone = (): void => {
    gone = true;
    wake();
  };
  socket.on("data", onData);
  socket.once("end", onGone);
  socket.once("close", onGone);
  return {
    async take(n) {
      while (buffered.length < n) {
        if (gone || socket.destroyed) return null;
        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
      const out = buffered.subarray(0, n);
      buffered = buffered.subarray(n);
      return out;
    },
    release() {
      socket.pause();
      socket.off("data", onData);
      socket.off("end", onGone);
      socket.off("close", onGone);
      const rest = buffered;
      buffered = Buffer.alloc(0);
      return rest;
    },
  };
}

function same(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** RFC 1929: VER ULEN UNAME PLEN PASSWD, checked in constant time. */
async function authenticated(
  reader: HandshakeReader,
  username: Buffer,
  password: Buffer,
): Promise<boolean> {
  const head = await reader.take(2);
  if (!head || head.readUInt8(0) !== AUTH_VERSION) return false;
  const user = await reader.take(head.readUInt8(1));
  const length = await reader.take(1);
  if (!user || !length) return false;
  const pass = await reader.take(length.readUInt8(0));
  if (!pass) return false;
  const userOk = same(user, username);
  const passOk = same(pass, password);
  return userOk && passOk;
}

function ipv6Text(bytes: Buffer): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
  return groups.join(":");
}

/**
 * The CONNECT request (RFC 1928 §4), or the reply to send when its address
 * type is unknown, or null when the client went away mid-request.
 */
async function readRequest(reader: HandshakeReader): Promise<Request | number | null> {
  const head = await reader.take(4); // VER CMD RSV ATYP
  if (!head || head.readUInt8(0) !== SOCKS_VERSION) return null;
  const command = head.readUInt8(1);
  const type = head.readUInt8(3);
  let target: SocksTarget;
  if (type === ATYP_IPV4) {
    const bytes = await reader.take(4);
    if (!bytes) return null;
    target = { kind: "address", address: [...bytes].join("."), family: 4 };
  } else if (type === ATYP_IPV6) {
    const bytes = await reader.take(16);
    if (!bytes) return null;
    target = { kind: "address", address: ipv6Text(bytes), family: 6 };
  } else if (type === ATYP_DOMAIN) {
    const length = await reader.take(1);
    const name = length ? await reader.take(length.readUInt8(0)) : null;
    if (!name) return null;
    target = { kind: "domain", name: name.toString("latin1") };
  } else {
    return REPLY.addressNotSupported;
  }
  const port = await reader.take(2);
  if (!port) return null;
  return { command, target, port: port.readUInt16BE(0) };
}

const DOMAIN = /^[A-Za-z0-9._-]{1,253}$/;

/** How a target is named in the report: never anything but a host name or an address. */
function hostOf(target: SocksTarget): string {
  if (target.kind === "address") return target.address;
  return DOMAIN.test(target.name) ? target.name.toLowerCase() : "(malformed name)";
}

/**
 * A domain judged as the URL parser reads it, so "0x7f.1" or "2130706433"
 * is judged as 127.0.0.1.
 */
function checkDomain(name: string): Result<HostTarget, GuardRefusal> {
  if (!DOMAIN.test(name)) return err("bad_url");
  let hostname: string;
  try {
    hostname = new URL(`http://${name}/`).hostname;
  } catch {
    return err("bad_url");
  }
  return checkHostname(hostname);
}

/** The one address a tunnel may go to, or why not. */
export async function judgeTarget(
  target: SocksTarget,
  port: number,
  lookup: LookupAll,
): Promise<Result<PinnedAddress, GuardRefusal>> {
  if (port !== 80 && port !== 443 && port < 1024) return err("port");
  const host =
    target.kind === "address"
      ? checkHostname(target.family === 6 ? `[${target.address}]` : target.address)
      : checkDomain(target.name);
  if (!host.ok) return host;
  return resolvePublic(host.value, lookup);
}

function reply(client: Socket, code: number): void {
  client.end(Buffer.from([SOCKS_VERSION, code, 0, ATYP_IPV4, 0, 0, 0, 0, 0, 0]));
}

/** A connection to a checked address, once it is open; null if it couldn't open in time. */
function open(
  connect: Connector,
  to: PinnedAddress & { readonly port: number },
  timeoutMs: number,
  track: (socket: Socket) => void,
): Promise<Socket | null> {
  const upstream = connect(to);
  track(upstream);
  return new Promise((resolve) => {
    const settle = (opened: boolean): void => {
      clearTimeout(timer);
      upstream.off("connect", onConnect);
      upstream.off("error", onError);
      upstream.off("close", onError);
      if (!opened) upstream.destroy();
      resolve(opened ? upstream : null);
    };
    const onConnect = (): void => settle(true);
    const onError = (): void => settle(false);
    const timer = setTimeout(() => settle(false), timeoutMs);
    upstream.once("connect", onConnect);
    upstream.once("error", onError);
    // Closed by the proxy's own close() while still connecting.
    upstream.once("close", onError);
  });
}

/** Starts a proxy for one capture, on 127.0.0.1 with fresh credentials. */
export async function startCaptureProxy(options: ProxyOptions = {}): Promise<CaptureProxy> {
  const lookup = options.lookup ?? systemLookup;
  const connect = options.connect ?? connectPinned;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const maxTunnels = options.maxTunnels ?? MAX_TUNNELS;
  const username = randomBytes(16).toString("hex");
  const password = randomBytes(16).toString("hex");
  const expectedUser = Buffer.from(username);
  const expectedPassword = Buffer.from(password);
  const sockets = new Set<Socket>();
  const refused: ProxyRefusal[] = [];
  const tunnels = { open: 0 };

  const track = (socket: Socket): void => {
    sockets.add(socket);
    // Errors end the socket; they never reach the process.
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
  };
  const note = (host: string, why: ProxyRefusal["why"]): void => {
    if (refused.length < MAX_REFUSALS) refused.push({ host, why });
  };

  async function serve(client: Socket): Promise<void> {
    client.setNoDelay(true);
    client.setTimeout(handshakeTimeoutMs, () => client.destroy());
    const reader = handshakeReader(client);
    // Greeting (RFC 1928 §3): VER NMETHODS METHODS. Only user and password will do.
    const greeting = await reader.take(2);
    if (!greeting || greeting.readUInt8(0) !== SOCKS_VERSION) {
      client.destroy();
      return;
    }
    const methods = await reader.take(greeting.readUInt8(1));
    if (!methods) {
      client.destroy();
      return;
    }
    if (!methods.includes(METHOD_USER_PASSWORD)) {
      client.end(Buffer.from([SOCKS_VERSION, NO_ACCEPTABLE_METHOD]));
      return;
    }
    client.write(Buffer.from([SOCKS_VERSION, METHOD_USER_PASSWORD]));
    if (!(await authenticated(reader, expectedUser, expectedPassword))) {
      client.end(Buffer.from([AUTH_VERSION, 1]));
      return;
    }
    client.write(Buffer.from([AUTH_VERSION, 0]));

    const request = await readRequest(reader);
    if (request === null) {
      client.destroy();
      return;
    }
    if (typeof request === "number") {
      reply(client, request);
      return;
    }
    const host = hostOf(request.target);
    if (request.command !== CMD_CONNECT) {
      note(host, "command");
      reply(client, REPLY.commandNotSupported);
      return;
    }
    const judged = await judgeTarget(request.target, request.port, lookup);
    if (!judged.ok) {
      note(host, judged.error);
      reply(client, judged.error === "unresolved" ? REPLY.hostUnreachable : REPLY.notAllowed);
      return;
    }
    if (tunnels.open >= maxTunnels) {
      note(host, "busy");
      reply(client, REPLY.failure);
      return;
    }
    // The handshake is done: from here the connect clock, then the capture's, apply.
    client.setTimeout(0);
    tunnels.open++;
    let held = true;
    const release = (): void => {
      if (held) tunnels.open--;
      held = false;
    };
    const upstream = await open(
      connect,
      { ...judged.value, port: request.port },
      connectTimeoutMs,
      track,
    );
    if (!upstream) {
      release();
      if (!client.destroyed) reply(client, REPLY.refused);
      return;
    }
    if (client.destroyed) {
      release();
      upstream.destroy();
      return;
    }
    const finish = (): void => {
      release();
      client.destroy();
      upstream.destroy();
    };
    client.once("close", finish);
    upstream.once("close", finish);
    client.write(Buffer.from([SOCKS_VERSION, REPLY.succeeded, 0, ATYP_IPV4, 0, 0, 0, 0, 0, 0]));
    // Anything the client sent ahead of the reply goes first, then the rest as it comes.
    const early = reader.release();
    if (early.length > 0) upstream.write(early);
    client.pipe(upstream);
    upstream.pipe(client);
  }

  const server = createServer((client) => {
    track(client);
    serve(client).catch(() => client.destroy());
  });
  server.maxConnections = maxTunnels * 2;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("capture proxy has no TCP address");
  }

  return {
    port: address.port,
    username,
    password,
    refusals: () => [...refused],
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
}
