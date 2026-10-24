import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as macaroon from "../src/macaroon.js";
import {
  isNodeId,
  nodeIdFromLinkKey,
  nodeIdFromPublicUrl,
  settleNodeId,
  type SettleNodeIdOptions,
} from "../src/node-id.js";
import { err, ok, type Result } from "../src/result.js";

const KEY = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const MINI = "https://mini.taila6c237.ts.net:8443";
const ROOT = "control-root-key-for-tests-0123456789";

let dir: string;
let path: string;
let keyAsked: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kleio-node-id-"));
  path = join(dir, "node-id");
  keyAsked = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function settle(
  publicUrl: string | undefined,
  key: Result<string, string> = ok(KEY),
): ReturnType<typeof settleNodeId> {
  const options: SettleNodeIdOptions = {
    path,
    ...(publicUrl !== undefined ? { publicUrl } : {}),
    linkPublicKey: async () => {
      keyAsked += 1;
      return key;
    },
  };
  return settleNodeId(options);
}

const stored = (): string => readFileSync(path, "utf8");

describe("settleNodeId", () => {
  it("with a public URL, stores its host name, as the node ID was before", async () => {
    expect(await settle(MINI)).toEqual(
      ok({ nodeId: "mini.taila6c237.ts.net", source: "public_url" }),
    );
    expect(stored()).toBe("mini.taila6c237.ts.net\n");
    expect(keyAsked).toBe(0);
  });

  it("without one, stores a name from the link key", async () => {
    expect(await settle(undefined)).toEqual(
      ok({ nodeId: "kleio-ea4a6c63e29c520a", source: "link_key" }),
    );
    expect(stored()).toBe("kleio-ea4a6c63e29c520a\n");
  });

  it("once stored, it wins over a new public URL and over none", async () => {
    await settle(MINI);
    for (const url of ["https://other.taila6c237.ts.net:8443", undefined]) {
      expect(await settle(url)).toEqual(ok({ nodeId: "mini.taila6c237.ts.net", source: "stored" }));
    }
    expect(stored()).toBe("mini.taila6c237.ts.net\n");
    expect(keyAsked).toBe(0);
  });

  it("an admin credential minted before node-id existed still verifies, with Tailscale and after it goes", async () => {
    // What serve did before: the node caveat was the public URL's host name.
    const before = macaroon.mint(ROOT, "admin-phone", [
      macaroon.expCaveat(new Date(Date.now() + 3_600_000)),
      macaroon.nodeCaveat(new URL(MINI).hostname),
    ]);
    // The first start after the update, with the public URL still set...
    const first = await settle(MINI);
    // ...and a later one with Tailscale gone.
    const later = await settle(undefined);
    for (const settled of [first, later]) {
      if (!settled.ok) throw new Error(settled.error);
      expect(
        macaroon.verify(ROOT, before, { now: new Date(), nodeId: settled.value.nodeId }),
      ).toEqual({ ok: true });
    }
    // A link name would have failed it.
    expect(
      macaroon.verify(ROOT, before, { now: new Date(), nodeId: nodeIdFromLinkKey(KEY) }),
    ).toEqual({ ok: false, reason: "wrong-node" });
  });

  it("never replaces a stored file that isn't a node ID", async () => {
    for (const bad of ["", "\n", "two words", "mini\nother", "x".repeat(254), "mini/../x"]) {
      writeFileSync(path, bad);
      const r = await settle(MINI);
      expect(r.ok ? null : r.error).toMatch(/doesn't hold a node ID/);
      expect(readFileSync(path, "utf8")).toBe(bad);
    }
  });

  it("stores nothing when the link key can't be read", async () => {
    expect(await settle(undefined, err("link.key can't be read (ENOENT)"))).toEqual(
      err("link.key can't be read (ENOENT)"),
    );
    expect(existsSync(path)).toBe(false);
  });
});

describe("node ID names", () => {
  it("a public URL gives its host name, an IP address included", () => {
    expect(nodeIdFromPublicUrl("https://Mini.Taila6c237.ts.net:8443/")).toBe(
      "mini.taila6c237.ts.net",
    );
    expect(nodeIdFromPublicUrl("http://127.0.0.1:54660")).toBe("127.0.0.1");
    expect(nodeIdFromPublicUrl("http://[::1]:8443")).toBe("[::1]");
  });

  it("each of those, and a link name, is a node ID", () => {
    for (const id of ["mini.taila6c237.ts.net", "127.0.0.1", "[::1]", nodeIdFromLinkKey(KEY)]) {
      expect(isNodeId(id), id).toBe(true);
    }
  });
});
