import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PairedDevice } from "../src/device-registry.js";
import { readLinkConfig, type LinkConfig, type LinkStateRead } from "../src/link.js";
import {
  createRelayList,
  hostOrderOf,
  linkConfigText,
  pingRelay,
  relayEntryProblem,
  relayListProblem,
  relayListStatus,
  WAIT_FOR_MS,
  waitingFor,
} from "../src/link-relays.js";

const OWN = "https://relay.example.com/";
const OTHER = "https://relay.example.org/";
const N0_EU = "https://euc1-1.relay.n0.iroh.link./";
const N0_US = "https://use1-1.relay.n0.iroh.link./";
const NOW = new Date("2026-10-26T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let scratch: string;
let servers: Server[] = [];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "kleio-host-relays-"));
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
  rmSync(scratch, { recursive: true, force: true });
});

function device(over: Partial<PairedDevice>): PairedDevice {
  return {
    deviceId: "d1",
    label: "iPhone",
    created: "2026-10-01T00:00:00Z",
    lastSeen: NOW.toISOString(),
    revoked: false,
    admin: false,
    push: null,
    liveStart: null,
    linkKey: "a".repeat(64),
    listVersion: null,
    ...over,
  };
}

function writeConfig(doc: unknown): void {
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(scratch, "config.json"), JSON.stringify(doc));
}

function fileDoc(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(scratch, "config.json"), "utf8")) as Record<string, unknown>;
}

describe("checking a relay list", () => {
  it("takes https relay addresses and n0, and says what's wrong with anything else", () => {
    expect(relayEntryProblem(OWN)).toBeNull();
    expect(relayEntryProblem("n0")).toBeNull();
    expect(relayEntryProblem("https://relay.example.com:8443/")).toBeNull();
    expect(relayEntryProblem("http://relay.example.com/")).toBe("isn't https");
    expect(relayEntryProblem("https://u:p@relay.example.com/")).toBe(
      "has a user name or password in it",
    );
    expect(relayEntryProblem("https://relay.example.com/relay")).toBe("has a path after the host");
    expect(relayEntryProblem("https://relay.example.com/?a=1")).toBe("has a query");
    expect(relayEntryProblem("https://relay.example.com/#x")).toBe("has a fragment");
    expect(relayEntryProblem("https://Relay.Example.com")).toBe(
      "should be written https://relay.example.com/",
    );
    expect(relayEntryProblem("relay")).toBe("isn't an address");
    expect(relayEntryProblem(7)).toBe("isn't an address");
    expect(relayEntryProblem(`https://${"a".repeat(200)}.example/`)).toBe("is over 200 characters");
  });

  it("takes 1 to 4 relays, none twice", () => {
    expect(relayListProblem([OWN, "n0"])).toBeNull();
    expect(relayListProblem([])).toBe("A relay list has 1 to 4 relays.");
    expect(relayListProblem(["n0", OWN, OTHER, "https://a.example/", "https://b.example/"])).toBe(
      "A relay list has 1 to 4 relays.",
    );
    expect(relayListProblem("n0")).toBe("A relay list has 1 to 4 relays.");
    expect(relayListProblem([OWN, OWN])).toBe("A relay is listed twice.");
    expect(relayListProblem(["n0", "http://relay.example.com/"])).toBe(
      "http://relay.example.com/ isn't https.",
    );
    expect(relayListProblem(["n0", ""])).toBe("Relay 2 isn't an address.");
  });
});

describe("the host's order while a list waits", () => {
  it("keeps the host on relays every device knows, the new list's order first", () => {
    // Adding a relay of one's own ahead of n0's: the host stays on n0's.
    expect(hostOrderOf(["n0"], [OWN, "n0"])).toEqual(["n0", OWN]);
    // Dropping n0's for one's own: n0's stays first until devices have it.
    expect(hostOrderOf(["n0"], [OWN])).toEqual(["n0", OWN]);
    // Reordering known relays: the new order at once.
    expect(hostOrderOf([OWN, "n0"], ["n0", OWN])).toEqual(["n0", OWN]);
    // Replacing one relay with another, n0's kept.
    expect(hostOrderOf([OWN, "n0"], [OTHER, "n0"])).toEqual(["n0", OWN, OTHER]);
  });

  it("never names more than 4", () => {
    const old = ["n0", OWN, OTHER, "https://a.example/"];
    const next = ["https://b.example/", "https://c.example/"];
    expect(hostOrderOf(old, next)).toEqual(old);
  });
});

describe("which devices a list waits for", () => {
  it("waits for live link devices seen in the last 30 days that haven't got it", () => {
    const waits = waitingFor(
      [
        device({ deviceId: "has-it", listVersion: 2 }),
        device({ deviceId: "behind", listVersion: 1 }),
        device({ deviceId: "never", listVersion: null }),
        device({ deviceId: "revoked", revoked: true }),
        device({ deviceId: "tailscale", linkKey: null }),
        device({
          deviceId: "away",
          lastSeen: new Date(NOW.getTime() - WAIT_FOR_MS - 1).toISOString(),
        }),
        device({
          deviceId: "new",
          lastSeen: null,
          created: new Date(NOW.getTime() - DAY).toISOString(),
        }),
      ],
      2,
      NOW,
    );
    expect(waits.map((d) => d.deviceId)).toEqual(["behind", "never", "new"]);
  });
});

describe("link/config.json", () => {
  it("writes a list in use as before, and a waiting one with its order and the last list", async () => {
    const inUse: LinkConfig = {
      listVersion: 3,
      relays: [OWN, "n0"],
      hostOrder: [OWN, "n0"],
      promoted: null,
    };
    expect(JSON.parse(linkConfigText(inUse))).toEqual({
      version: 1,
      listVersion: 3,
      relays: [OWN, "n0"],
    });
    const waiting: LinkConfig = {
      listVersion: 4,
      relays: [OTHER, "n0"],
      hostOrder: ["n0", OWN, OTHER],
      promoted: [OWN, "n0"],
    };
    writeFileSync(join(scratch, "config.json"), linkConfigText(waiting));
    // kleio-link-host reads `relays`: the host's order.
    expect(fileDoc().relays).toEqual(["n0", OWN, OTHER]);
    expect(await readLinkConfig(scratch)).toEqual({ ok: true, value: waiting });
  });

  it("writes a waiting list as kleio-link-host's tests read it (the shared fixture)", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../kleio-link/tests/fixtures/relay-config.json", import.meta.url),
        "utf8",
      ),
    ) as { waiting: unknown };
    const text = linkConfigText({
      listVersion: 4,
      relays: [OWN],
      hostOrder: ["n0", OWN],
      promoted: ["n0"],
    });
    expect(JSON.parse(text)).toEqual(fixture.waiting);
  });

  it("refuses a list and its last list apart, or a bad one", async () => {
    for (const bad of [
      { version: 1, listVersion: 1, relays: ["n0"], list: [OWN] },
      { version: 1, listVersion: 1, relays: ["n0"], promoted: ["n0"] },
      { version: 1, listVersion: 1, relays: ["n0"], list: [], promoted: ["n0"] },
      { version: 1, listVersion: 1, relays: ["n0"], list: [OWN], promoted: ["http://x/"] },
    ]) {
      writeConfig(bad);
      expect((await readLinkConfig(scratch)).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("changing the list", () => {
  function relayList(devices: PairedDevice[], logs: string[] = []) {
    return createRelayList({
      dir: scratch,
      devices: () => devices,
      now: () => NOW,
      log: (m) => logs.push(m),
    });
  }

  it("keeps the host on known relays until every device has the new list", async () => {
    const phone = device({ deviceId: "phone", listVersion: 0 });
    const devices = [phone];
    const list = relayList(devices);
    const set = await list.set(0, [OWN, "n0"]);
    expect(set).toEqual({
      ok: true,
      value: { listVersion: 1, relays: [OWN, "n0"], hostOrder: ["n0", OWN], promoted: ["n0"] },
    });
    expect(fileDoc()).toEqual({
      version: 1,
      listVersion: 1,
      relays: ["n0", OWN],
      list: [OWN, "n0"],
      promoted: ["n0"],
    });
    // The phone gets it: nothing waits, and the host uses it.
    devices[0] = { ...phone, listVersion: 1 };
    expect((await list.settle()).ok).toBe(true);
    expect(fileDoc()).toEqual({ version: 1, listVersion: 1, relays: [OWN, "n0"] });
  });

  it("uses a new list at once when no device waits for it", async () => {
    const list = relayList([device({ linkKey: null })]);
    await list.set(0, [OWN]);
    expect(fileDoc()).toEqual({ version: 1, listVersion: 1, relays: [OWN] });
  });

  it("refuses a change to a list that has changed since, and leaves an unchanged list alone", async () => {
    const list = relayList([device({ listVersion: 0 })]);
    expect((await list.set(0, [OWN, "n0"])).ok).toBe(true);
    expect(await list.set(0, [OTHER])).toEqual({
      ok: false,
      error: { kind: "stale", listVersion: 1 },
    });
    const same = await list.set(1, [OWN, "n0"]);
    expect(same.ok && same.value.listVersion).toBe(1);
  });

  it("keeps the last list every device had through a second change", async () => {
    const list = relayList([device({ listVersion: 0 })]);
    await list.set(0, [OWN, "n0"]);
    const second = await list.set(1, [OTHER, "n0"]);
    expect(second).toEqual({
      ok: true,
      value: {
        listVersion: 2,
        relays: [OTHER, "n0"],
        hostOrder: ["n0", OTHER],
        promoted: ["n0"],
      },
    });
  });

  it("uses a waiting list now when an admin says so", async () => {
    const logs: string[] = [];
    const list = relayList([device({ listVersion: 0 })], logs);
    await list.set(0, [OWN]);
    expect(await list.useNow(0)).toEqual({ ok: false, error: { kind: "stale", listVersion: 1 } });
    const used = await list.useNow(1);
    expect(used.ok && used.value.promoted).toBeNull();
    expect(fileDoc()).toEqual({ version: 1, listVersion: 1, relays: [OWN] });
    expect(logs.some((l) => l.includes("an admin uses relay list 1 now"))).toBe(true);
  });

  it("makes one change at a time", async () => {
    const list = relayList([device({ listVersion: 0 })]);
    const [a, b] = await Promise.all([list.set(0, [OWN]), list.set(0, [OTHER])]);
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(fileDoc().list).toEqual([OWN]);
  });
});

describe("the list's status", () => {
  const running = (relays: { url: string; state: string }[]): LinkStateRead => ({
    kind: "running",
    state: {
      updatedAt: NOW.toISOString(),
      pid: 1,
      key: "k".repeat(64),
      relay: N0_EU,
      pairKey: "p".repeat(64),
      pairRelay: N0_EU,
      addrs: [],
      rateLimited: false,
      connections: 1,
      relays,
      peers: [],
    },
  });

  it("gives each relay's state, n0's as its best relay's, and what's new", () => {
    const status = relayListStatus(
      { listVersion: 2, relays: [OWN, "n0"], hostOrder: ["n0", OWN], promoted: ["n0"] },
      running([
        { url: N0_EU, state: "home" },
        { url: N0_US, state: "standby" },
        { url: OWN, state: "standby" },
      ]),
      [device({ deviceId: "phone", label: "Finn's iPhone", listVersion: 1 })],
      NOW,
      true,
    );
    expect(status).toEqual({
      listVersion: 2,
      relays: [
        { entry: OWN, state: "standby", new: true },
        { entry: "n0", state: "home", new: false },
      ],
      inUse: false,
      hostRelay: N0_EU,
      waiting: 1,
      waitingFor: [{ deviceId: "phone", label: "Finn's iPhone", lastSeen: NOW.toISOString() }],
    });
  });

  it("names the devices it waits for to admins only, and says unknown while the link is down", () => {
    const status = relayListStatus(
      { listVersion: 2, relays: [OWN], hostOrder: ["n0", OWN], promoted: ["n0"] },
      { kind: "missing" },
      [device({ listVersion: 1 })],
      NOW,
      false,
    );
    expect(status).toEqual({
      listVersion: 2,
      relays: [{ entry: OWN, state: "unknown", new: true }],
      inUse: false,
      hostRelay: null,
      waiting: 1,
    });
  });
});

describe("asking a relay", () => {
  /** A server answering /ping with `status` and `body`, asked over plain HTTP. */
  async function answering(
    status: number,
    body = "",
    wait = false,
  ): Promise<(url: URL, o: object) => ReturnType<typeof httpRequest>> {
    const server = createServer((req, res) => {
      if (wait) return;
      expect(req.url).toBe("/ping");
      res.writeHead(status);
      res.end(body);
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    return (url, options) =>
      httpRequest(new URL(url.pathname, `http://127.0.0.1:${port}`), options);
  }

  it("says a relay answered when /ping gives 200 with nothing in it", async () => {
    const ping = await pingRelay(OWN, { open: await answering(200) });
    expect(ping.kind).toBe("relay");
  });

  it("says something that answers otherwise isn't a relay", async () => {
    expect(await pingRelay(OWN, { open: await answering(404) })).toEqual({
      kind: "not_a_relay",
      detail: "answered HTTP 404, as a relay doesn't",
    });
    expect(await pingRelay(OWN, { open: await answering(200, "<html>") })).toEqual({
      kind: "not_a_relay",
      detail: "answered with a body, as a relay doesn't",
    });
  });

  it("says nothing answered, within its time", async () => {
    const slow = await pingRelay(OWN, { open: await answering(200, "", true), timeoutMs: 200 });
    expect(slow).toEqual({ kind: "no_answer", detail: "no answer in 0.2 s" });
    const refused = await pingRelay("https://127.0.0.1:1/");
    expect(refused).toEqual({ kind: "no_answer", detail: "ECONNREFUSED" });
  });
});
