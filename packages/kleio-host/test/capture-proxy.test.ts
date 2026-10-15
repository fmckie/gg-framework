// The SOCKS5 proxy a page capture's web view goes through (capture-proxy.ts):
// only signed-in clients, CONNECT only, every target judged by the same
// address policy as the host's own fetches and pinned to the address that was
// checked, and every tunnel closed with it. A fake resolver gives made-up
// names their addresses, and the fake connector records where each tunnel
// was asked to go while only ever reaching a local echo server.

import { once } from "node:events";
import {
  connect as netConnect,
  createServer,
  isIPv4,
  type AddressInfo,
  type Socket,
} from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  judgeTarget,
  startCaptureProxy,
  type CaptureProxy,
  type ProxyOptions,
} from "../src/capture-proxy.js";
import { ipv6Groups, type LookupAll } from "../src/net-guard.js";

const DNS: Readonly<Record<string, readonly string[]>> = {
  "site.test": ["93.184.215.14"],
  "private.test": ["192.168.1.10"],
  "mixed.test": ["93.184.215.14", "10.0.0.5"],
};

const lookupIn: LookupAll = async (name) => {
  const found = DNS[name];
  if (!found) throw new Error(`ENOTFOUND ${name}`);
  return found.map((address) => ({ address, family: isIPv4(address) ? 4 : 6 }));
};

interface Rig {
  readonly proxy: CaptureProxy;
  /** Names looked up, in order. */
  readonly lookups: string[];
  /** "address port" each tunnel was asked to go to, in order. */
  readonly connects: string[];
}

/** A proxy and an echo server for one test, both closed when it finishes. */
async function rig(options: ProxyOptions = {}, upstreamPort?: number): Promise<Rig> {
  const echoSockets = new Set<Socket>();
  const echo = createServer((socket) => {
    echoSockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.pipe(socket);
  });
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
  const echoPort = upstreamPort ?? (echo.address() as AddressInfo).port;
  const lookups: string[] = [];
  const connects: string[] = [];
  const proxy = await startCaptureProxy({
    lookup: async (name) => {
      lookups.push(name);
      return lookupIn(name);
    },
    connect: (to) => {
      connects.push(`${to.address} ${to.port}`);
      return netConnect({ host: "127.0.0.1", port: echoPort });
    },
    ...options,
  });
  onTestFinished(async () => {
    await proxy.close();
    for (const socket of echoSockets) socket.destroy();
    await new Promise<void>((r) => echo.close(() => r()));
  });
  return { proxy, lookups, connects };
}

interface Client {
  readonly socket: Socket;
  /** The next `n` bytes from the proxy; throws if it hangs up first. */
  readonly read: (n: number) => Promise<Buffer>;
  readonly closed: Promise<void>;
}

async function dial(proxy: CaptureProxy): Promise<Client> {
  const socket = netConnect({ host: "127.0.0.1", port: proxy.port });
  socket.on("error", () => socket.destroy());
  await once(socket, "connect");
  let buffered = Buffer.alloc(0);
  let ended = false;
  const waiting: (() => void)[] = [];
  const wake = (): void => {
    for (const w of waiting.splice(0)) w();
  };
  socket.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    wake();
  });
  const closed = new Promise<void>((resolve) =>
    socket.once("close", () => {
      ended = true;
      wake();
      resolve();
    }),
  );
  onTestFinished(() => {
    socket.destroy();
  });
  return {
    socket,
    closed,
    read: async (n) => {
      while (buffered.length < n) {
        if (ended) throw new Error(`proxy hung up after ${buffered.length} of ${n} bytes`);
        await new Promise<void>((r) => waiting.push(r));
      }
      const out = buffered.subarray(0, n);
      buffered = buffered.subarray(n);
      return out;
    },
  };
}

/** Greets offering user and password, signs in, and returns the status (0 = accepted). */
async function signIn(c: Client, username: string, password: string): Promise<number> {
  c.socket.write(Buffer.from([5, 1, 2]));
  expect([...(await c.read(2))]).toEqual([5, 2]);
  c.socket.write(
    Buffer.concat([
      Buffer.from([1, username.length]),
      Buffer.from(username),
      Buffer.from([password.length]),
      Buffer.from(password),
    ]),
  );
  return (await c.read(2)).readUInt8(1);
}

type Target = { readonly ipv4: string } | { readonly ipv6: string } | { readonly domain: string };

function address(target: Target): Buffer {
  if ("ipv4" in target) return Buffer.from([1, ...target.ipv4.split(".").map(Number)]);
  if ("ipv6" in target) {
    const groups = ipv6Groups(target.ipv6);
    if (!groups) throw new Error(`not IPv6: ${target.ipv6}`);
    return Buffer.from([4, ...groups.flatMap((g) => [g >> 8, g & 0xff])]);
  }
  return Buffer.concat([Buffer.from([3, target.domain.length]), Buffer.from(target.domain)]);
}

/** Sends a request and returns the proxy's reply code (0 = tunnel open). */
async function ask(c: Client, target: Target, port: number, command = 1): Promise<number> {
  const portBytes = Buffer.from([port >> 8, port & 0xff]);
  c.socket.write(Buffer.concat([Buffer.from([5, command, 0]), address(target), portBytes]));
  const reply = await c.read(10);
  expect(reply.readUInt8(0)).toBe(5);
  return reply.readUInt8(1);
}

async function tunnel(
  proxy: CaptureProxy,
  target: Target,
  port: number,
): Promise<[number, Client]> {
  const c = await dial(proxy);
  expect(await signIn(c, proxy.username, proxy.password)).toBe(0);
  return [await ask(c, target, port), c];
}

describe("capture proxy: tunnels", () => {
  it("tunnels to a public name, resolved once and pinned to the address it checked", async () => {
    const { proxy, lookups, connects } = await rig();
    const [code, c] = await tunnel(proxy, { domain: "site.test" }, 443);
    expect(code).toBe(0);
    c.socket.write("ping");
    expect((await c.read(4)).toString()).toBe("ping");
    expect(lookups).toEqual(["site.test"]);
    expect(connects).toEqual(["93.184.215.14 443"]);
  });

  it("tunnels to public addresses given as addresses, without a lookup", async () => {
    const { proxy, lookups, connects } = await rig();
    expect((await tunnel(proxy, { ipv4: "8.8.8.8" }, 80))[0]).toBe(0);
    expect((await tunnel(proxy, { ipv6: "2606:4700:4700::1111" }, 443))[0]).toBe(0);
    expect(lookups).toEqual([]);
    expect(connects).toEqual(["8.8.8.8 80", "2606:4700:4700:0:0:0:0:1111 443"]);
  });

  it.each<[string, Target, number]>([
    ["loopback", { ipv4: "127.0.0.1" }, 2],
    ["a private address", { ipv4: "10.0.0.1" }, 2],
    ["cloud metadata", { ipv4: "169.254.169.254" }, 2],
    ["Tailscale's resolver", { ipv4: "100.100.100.100" }, 2],
    ["the home network", { ipv4: "192.168.1.1" }, 2],
    ["this network", { ipv4: "0.0.0.0" }, 2],
    ["IPv6 loopback", { ipv6: "::1" }, 2],
    ["IPv4-mapped loopback", { ipv6: "::ffff:127.0.0.1" }, 2],
    ["the tailnet", { ipv6: "fd7a:115c:a1e0::1" }, 2],
    ["IPv6 link-local", { ipv6: "fe80::1" }, 2],
    ["localhost", { domain: "localhost" }, 2],
    ["a .local name", { domain: "printer.local" }, 2],
    ["a tailnet name", { domain: "mac-mini-1.taila6c237.ts.net" }, 2],
    ["a name for a private address", { domain: "private.test" }, 2],
    ["a name with one private address", { domain: "mixed.test" }, 2],
    ["a hex spelling of loopback", { domain: "0x7f.1" }, 2],
    ["a decimal spelling of loopback", { domain: "2130706433" }, 2],
    ["a malformed name", { domain: "site.test@127.0.0.1" }, 2],
    ["a name that doesn't resolve", { domain: "unknown.test" }, 4],
  ])("refuses %s without connecting", async (_label, target, code) => {
    const { proxy, connects } = await rig();
    const [got, c] = await tunnel(proxy, target, 80);
    expect(got).toBe(code);
    await c.closed;
    expect(connects).toEqual([]);
  });

  it("allows ports 80, 443 and 1024 and up only", async () => {
    const { proxy, connects } = await rig();
    expect((await tunnel(proxy, { domain: "site.test" }, 22))[0]).toBe(2);
    expect((await tunnel(proxy, { domain: "site.test" }, 25))[0]).toBe(2);
    expect((await tunnel(proxy, { domain: "site.test" }, 8080))[0]).toBe(0);
    expect(connects).toEqual(["93.184.215.14 8080"]);
    for (const [port, allowed] of [
      [0, false],
      [21, false],
      [445, false],
      [1023, false],
      [80, true],
      [443, true],
      [1024, true],
      [65535, true],
    ] as const) {
      const judged = await judgeTarget(
        { kind: "address", address: "8.8.8.8", family: 4 },
        port,
        lookupIn,
      );
      expect(judged.ok, String(port)).toBe(allowed);
    }
  });

  it("remembers what it refused, by host only", async () => {
    const { proxy } = await rig();
    await tunnel(proxy, { domain: "localhost" }, 80);
    await tunnel(proxy, { ipv4: "127.0.0.1" }, 443);
    await tunnel(proxy, { domain: "site.test@127.0.0.1" }, 80);
    expect(proxy.refusals()).toEqual([
      { host: "localhost", why: "local_name" },
      { host: "127.0.0.1", why: "private_address" },
      { host: "(malformed name)", why: "bad_url" },
    ]);
  });
});

describe("capture proxy: who may use it", () => {
  it("makes fresh credentials for each capture", async () => {
    const a = (await rig()).proxy;
    const b = (await rig()).proxy;
    expect(a.username).toMatch(/^[0-9a-f]{32}$/);
    expect(a.password).toMatch(/^[0-9a-f]{32}$/);
    expect(a.password).not.toBe(b.password);
    expect(a.username).not.toBe(b.username);
  });

  it("turns away a client that won't sign in", async () => {
    const { proxy } = await rig();
    const c = await dial(proxy);
    c.socket.write(Buffer.from([5, 1, 0])); // "no authentication" only
    expect([...(await c.read(2))]).toEqual([5, 0xff]);
    await c.closed;
  });

  it("refuses a wrong password or user name, and opens nothing", async () => {
    const { proxy, connects } = await rig();
    const wrongPassword = await dial(proxy);
    expect(await signIn(wrongPassword, proxy.username, "0".repeat(32))).toBe(1);
    await wrongPassword.closed;
    const wrongUser = await dial(proxy);
    expect(await signIn(wrongUser, "someone", proxy.password)).toBe(1);
    await wrongUser.closed;
    expect(connects).toEqual([]);
  });

  it("refuses BIND and UDP ASSOCIATE, so only TCP leaves", async () => {
    const { proxy, connects } = await rig();
    for (const command of [2, 3]) {
      const c = await dial(proxy);
      expect(await signIn(c, proxy.username, proxy.password)).toBe(0);
      expect(await ask(c, { domain: "site.test" }, 443, command)).toBe(7);
    }
    expect(connects).toEqual([]);
    expect(proxy.refusals()).toEqual([
      { host: "site.test", why: "command" },
      { host: "site.test", why: "command" },
    ]);
  });

  it("refuses an address type it doesn't know", async () => {
    const { proxy } = await rig();
    const c = await dial(proxy);
    expect(await signIn(c, proxy.username, proxy.password)).toBe(0);
    c.socket.write(Buffer.from([5, 1, 0, 9, 1, 2, 3, 4, 0, 80]));
    expect((await c.read(10)).readUInt8(1)).toBe(8);
  });

  it("takes a handshake that arrives a byte at a time, and the host keeps running", async () => {
    const { proxy, connects } = await rig();
    const c = await dial(proxy);
    let ticks = 0;
    const clock = setInterval(() => ticks++, 5);
    onTestFinished(() => clearInterval(clock));
    const user = Buffer.from(proxy.username);
    const pass = Buffer.from(proxy.password);
    const handshake = [
      Buffer.from([5, 1, 2]),
      Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]),
      Buffer.concat([
        Buffer.from([5, 1, 0]),
        address({ domain: "site.test" }),
        Buffer.from([1, 187]),
      ]),
    ];
    for (const byte of Buffer.concat(handshake)) {
      c.socket.write(Buffer.from([byte]));
      await new Promise((r) => setTimeout(r, 1));
    }
    expect([...(await c.read(2))]).toEqual([5, 2]);
    expect([...(await c.read(2))]).toEqual([1, 0]);
    expect((await c.read(10)).readUInt8(1)).toBe(0);
    expect(connects).toEqual(["93.184.215.14 443"]);
    expect(ticks).toBeGreaterThan(0);
  });

  it("passes on bytes the client sent ahead of the reply", async () => {
    const { proxy } = await rig();
    const c = await dial(proxy);
    expect(await signIn(c, proxy.username, proxy.password)).toBe(0);
    const request = Buffer.concat([
      Buffer.from([5, 1, 0]),
      address({ domain: "site.test" }),
      Buffer.from([1, 187]),
    ]);
    c.socket.write(Buffer.concat([request, Buffer.from("early")]));
    expect((await c.read(10)).readUInt8(1)).toBe(0);
    expect((await c.read(5)).toString()).toBe("early");
  });

  it("drops a client that never finishes the handshake", async () => {
    const { proxy } = await rig({ handshakeTimeoutMs: 100 });
    const c = await dial(proxy);
    c.socket.write(Buffer.from([5]));
    await c.closed;
  });
});

describe("capture proxy: limits and the end of a capture", () => {
  it("caps the tunnels open at once, and frees a slot when one closes", async () => {
    const { proxy } = await rig({ maxTunnels: 1 });
    const [first, held] = await tunnel(proxy, { domain: "site.test" }, 443);
    expect(first).toBe(0);
    expect((await tunnel(proxy, { domain: "site.test" }, 443))[0]).toBe(1);
    expect(proxy.refusals()).toContainEqual({ host: "site.test", why: "busy" });
    held.socket.destroy();
    let code = 1;
    for (let tries = 0; tries < 50 && code !== 0; tries++) {
      await new Promise((r) => setTimeout(r, 10));
      code = (await tunnel(proxy, { domain: "site.test" }, 443))[0];
    }
    expect(code).toBe(0);
  });

  it("says so when the site won't take the connection", async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const { proxy } = await rig({}, port);
    expect((await tunnel(proxy, { domain: "site.test" }, 443))[0]).toBe(5);
  });

  it("closes every tunnel when the capture ends", async () => {
    const { proxy } = await rig();
    const [code, c] = await tunnel(proxy, { domain: "site.test" }, 443);
    expect(code).toBe(0);
    await proxy.close();
    await c.closed;
  });
});
