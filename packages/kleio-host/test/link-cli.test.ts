import { describe, expect, it } from "vitest";
import type { PairedDevice } from "../src/device-registry.js";
import type { LinkState } from "../src/link.js";
import {
  deviceFrom,
  deviceLine,
  linkHostBin,
  linkStatusLines,
  MIN_KEY_PREFIX,
  noTicketText,
  revokeTarget,
} from "../src/link-cli.js";

const KEY_A = `a1b2c3d4e5${"0".repeat(54)}`;
const KEY_B = `a1b2c3d4ff${"0".repeat(54)}`;
const N0_EU = "https://euc1-1.relay.n0.iroh.link./";

function device(over: Partial<PairedDevice>): PairedDevice {
  return {
    deviceId: "6f1c2a9e-0000-4000-8000-000000000001",
    label: "iPhone",
    created: "2026-10-23T09:00:00.000Z",
    lastSeen: "2026-10-23T11:58:30.000Z",
    revoked: false,
    admin: false,
    push: null,
    liveStart: null,
    linkKey: null,
    ...over,
  };
}

describe("kleio-link-host's path", () => {
  it("is bin/ beside this install's dist/, never a PATH lookup", () => {
    expect(linkHostBin({}, "darwin", "/Users/k/kleio-host/dist/cli.js")).toEqual({
      ok: true,
      value: "/Users/k/kleio-host/bin/kleio-link-host",
    });
    expect(linkHostBin({}, "win32", "/k/kleio-host/dist/cli.js")).toEqual({
      ok: true,
      value: "/k/kleio-host/bin/kleio-link-host.exe",
    });
  });

  it("takes KLEIO_LINK_HOST_BIN only as an absolute path", () => {
    const cli = "/k/dist/cli.js";
    expect(linkHostBin({ KLEIO_LINK_HOST_BIN: "/opt/kleio-link-host" }, "linux", cli)).toEqual({
      ok: true,
      value: "/opt/kleio-link-host",
    });
    expect(linkHostBin({ KLEIO_LINK_HOST_BIN: "kleio-link-host" }, "linux", cli).ok).toBe(false);
    expect(linkHostBin({ KLEIO_LINK_HOST_BIN: "" }, "linux", cli)).toEqual({
      ok: true,
      value: "/k/bin/kleio-link-host",
    });
  });
});

describe("why pair has no QR code", () => {
  it("says what to do for each reason", () => {
    expect(noTicketText("link_down", "/s/link")).toContain("kleio-link-host isn't running");
    expect(noTicketText("config", "/s/link")).toContain("/s/link/config.json");
    expect(noTicketText("no_link", "/s/link")).toContain("doesn't serve Kleio's link");
    expect(noTicketText(null, "/s/link")).toContain("couldn't be made");
  });
});

describe("revoke's argument", () => {
  const phone = device({ deviceId: "id-phone", linkKey: KEY_A });
  const pad = device({ deviceId: "id-pad", label: "iPad", linkKey: KEY_B });
  const gone = device({
    deviceId: "id-gone",
    linkKey: `a1b2c3d4e5ee${"0".repeat(52)}`,
    revoked: true,
  });
  const laptop = device({ deviceId: "id-laptop", label: "Laptop" });
  const all = [phone, pad, gone, laptop];

  it("is a device ID first", () => {
    expect(revokeTarget(all, "id-laptop")).toEqual({ ok: true, value: laptop });
    expect(revokeTarget(all, "id-gone")).toEqual({ ok: true, value: gone });
  });

  it("else a prefix of one paired device's link key, as devices and the log show it", () => {
    expect(revokeTarget(all, "a1b2c3d4e5")).toEqual({ ok: true, value: phone });
    expect(revokeTarget(all, "A1B2C3D4FF")).toEqual({ ok: true, value: pad });
    expect(revokeTarget(all, KEY_A)).toEqual({ ok: true, value: phone });
  });

  it("refuses a prefix that's short, matches two, or matches none", () => {
    const short = revokeTarget(all, "a1b2c3d");
    expect(short.ok ? "" : short.error).toContain(`at least ${MIN_KEY_PREFIX}`);
    const two = revokeTarget(all, "a1b2c3d4");
    expect(two.ok ? "" : two.error).toContain("2 paired devices");
    const none = revokeTarget(all, "ffffffff");
    expect(none.ok ? "" : none.error).toContain("No paired device");
    const id = revokeTarget(all, "id-nope");
    expect(id.ok ? "" : id.error).toContain("No device has the ID id-nope");
  });
});

describe("devices' lines", () => {
  it("shows a link device's key prefix and the path it last took", () => {
    const peers = [{ key: KEY_A, path: "direct" as const, at: "2026-10-23T12:03:04.000Z" }];
    expect(deviceLine(device({ linkKey: KEY_A, admin: true }), peers)).toBe(
      "✓ 6f1c2a9e-0000-4000-8000-000000000001  iPhone [admin]  paired 2026-10-23  seen 2026-10-23T11:58  link a1b2c3d4e5 (direct at 2026-10-23T12:03)",
    );
    expect(deviceLine(device({ linkKey: KEY_B, revoked: true }), peers)).toBe(
      "✗ 6f1c2a9e-0000-4000-8000-000000000001  iPhone  paired 2026-10-23  seen 2026-10-23T11:58  link a1b2c3d4ff (no connection seen)",
    );
  });

  it("says a device without a key was paired over its own network", () => {
    expect(deviceLine(device({ lastSeen: null }), [])).toBe(
      "✓ 6f1c2a9e-0000-4000-8000-000000000001  iPhone  paired 2026-10-23  seen never  own network",
    );
  });

  it("reads a device from a host that predates the link as one without a key", () => {
    const old = { ...device({}), linkKey: undefined } as unknown as PairedDevice;
    expect(deviceFrom(old).linkKey).toBeNull();
  });
});

describe("status's link lines", () => {
  const state: LinkState = {
    updatedAt: "2026-10-23T12:00:00.000Z",
    pid: 4242,
    key: KEY_A,
    relay: N0_EU,
    addrs: ["192.168.1.20:52043"],
    rateLimited: false,
    connections: 2,
    relays: [],
    peers: [],
  };

  it("says where the link is while it runs", () => {
    expect(linkStatusLines({ kind: "running", state }, KEY_A)).toEqual([
      `link: running, on ${N0_EU} (n0's); key a1b2c3d4e5`,
      "      2 connection(s); direct addresses: 192.168.1.20:52043",
    ]);
    const own = { ...state, relay: "https://relay.example.com/", rateLimited: true, addrs: [] };
    expect(linkStatusLines({ kind: "running", state: own }, KEY_A)).toEqual([
      "link: running, on https://relay.example.com/, slowed by its relay; key a1b2c3d4e5",
      "      2 connection(s); direct addresses: none",
    ]);
    expect(linkStatusLines({ kind: "running", state: { ...state, relay: null } }, KEY_A)[0]).toBe(
      "link: running, on no relay; key a1b2c3d4e5",
    );
  });

  it("says when it isn't running, hasn't started, or its state is wrong", () => {
    expect(linkStatusLines({ kind: "stale", state }, KEY_A)).toEqual([
      "link: kleio-link-host isn't running (its state is from 2026-10-23T12:00:00.000Z); key a1b2c3d4e5",
    ]);
    expect(linkStatusLines({ kind: "missing" }, null)).toEqual([
      "link: kleio-link-host hasn't written its state yet; no key yet",
    ]);
    expect(linkStatusLines({ kind: "invalid", message: "state.json: no pid" }, KEY_A)).toEqual([
      "link: state.json: no pid",
    ]);
  });
});
