// The address and URL policy for what the host fetches for a voice show
// (net-guard.ts): every refused range at its edges, the IPv4 forms inside
// IPv6, alternative IPv4 spellings, and one pinned lookup per name.

import { describe, expect, it } from "vitest";
import {
  checkHostname,
  checkUrl,
  embeddedIPv4,
  ipv6Groups,
  isRefusedAddress,
  portOf,
  resolvePublic,
  URL_MAX,
  type LookupAll,
} from "../src/net-guard.js";

describe("isRefusedAddress: IPv4", () => {
  // [first, last] of each refused range, then the addresses just outside it.
  const ranges: [string, string, string | null, string | null][] = [
    ["0.0.0.0", "0.255.255.255", null, "1.0.0.0"],
    ["10.0.0.0", "10.255.255.255", "9.255.255.255", "11.0.0.0"],
    ["100.64.0.0", "100.127.255.255", "100.63.255.255", "100.128.0.0"],
    ["127.0.0.0", "127.255.255.255", "126.255.255.255", "128.0.0.0"],
    ["169.254.0.0", "169.254.255.255", "169.253.255.255", "169.255.0.0"],
    ["172.16.0.0", "172.31.255.255", "172.15.255.255", "172.32.0.0"],
    ["192.0.0.0", "192.0.0.255", "191.255.255.255", "192.0.1.0"],
    ["192.0.2.0", "192.0.2.255", "192.0.1.255", "192.0.3.0"],
    ["192.168.0.0", "192.168.255.255", "192.167.255.255", "192.169.0.0"],
    ["198.18.0.0", "198.19.255.255", "198.17.255.255", "198.20.0.0"],
    ["198.51.100.0", "198.51.100.255", "198.51.99.255", "198.51.101.0"],
    ["203.0.113.0", "203.0.113.255", "203.0.112.255", "203.0.114.0"],
    ["224.0.0.0", "239.255.255.255", "223.255.255.255", null],
    ["240.0.0.0", "255.255.255.255", null, null],
  ];
  it.each(ranges)("refuses %s to %s and allows its neighbours", (first, last, before, after) => {
    expect(isRefusedAddress(first)).toBe(true);
    expect(isRefusedAddress(last)).toBe(true);
    if (before) expect(isRefusedAddress(before)).toBe(false);
    if (after) expect(isRefusedAddress(after)).toBe(false);
  });

  it("refuses Tailscale's own resolver and cloud metadata, and allows public addresses", () => {
    expect(isRefusedAddress("100.100.100.100")).toBe(true);
    expect(isRefusedAddress("169.254.169.254")).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.215.14", "151.101.0.81"]) {
      expect(isRefusedAddress(ip), ip).toBe(false);
    }
  });

  it("refuses anything that isn't an address", () => {
    for (const s of ["", "localhost", "example.com", "1.2.3", "256.1.1.1", "01.2.3.4"]) {
      expect(isRefusedAddress(s), s).toBe(true);
    }
  });
});

describe("isRefusedAddress: IPv6", () => {
  it("refuses every non-global range", () => {
    for (const ip of [
      "::",
      "::1",
      "0:0:0:0:0:0:0:1",
      "::7f00:1", // IPv4-compatible
      "100::1", // discard
      "fc00::1",
      "fd7a:115c:a1e0::1", // Tailscale
      "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fe80::1",
      "fe80::1%en0",
      "febf::1",
      "fec0::1", // site-local
      "ff02::1",
      "ff0e::1",
      "2001::1", // Teredo
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "2001:db8::1",
      "2001:db8:ffff::1",
      "3fff::1",
      "64:ff9b:1::1", // local-use NAT64
    ]) {
      expect(isRefusedAddress(ip), ip).toBe(true);
    }
  });

  it("allows global unicast", () => {
    for (const ip of [
      "2606:4700:4700::1111",
      "2a00:1450:4009:81f::200e",
      "2001:4860:4860::8888",
      "2c0f:fb50:4002::1",
    ]) {
      expect(isRefusedAddress(ip), ip).toBe(false);
    }
  });

  it("judges mapped, NAT64 and 6to4 addresses by the IPv4 address inside", () => {
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::ffff:100.100.100.100",
      "::ffff:169.254.169.254",
      "64:ff9b::7f00:1",
      "64:ff9b::10.1.2.3",
      "64:ff9b::a9fe:a9fe",
      "2002:7f00:1::",
      "2002:a9fe:a9fe::1",
      "2002:c0a8:10a::",
      "2002:6440:1::", // 100.64.0.1
    ]) {
      expect(isRefusedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::1"]) {
      expect(isRefusedAddress(ip), ip).toBe(false);
    }
  });

  it("expands IPv6 groups and finds the IPv4 inside", () => {
    expect(ipv6Groups("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ipv6Groups("1::")).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(ipv6Groups("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(ipv6Groups("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ipv6Groups("1.2.3.4")).toBeNull();
    expect(ipv6Groups("fe80::1%lo0")).toBeNull();
    expect(embeddedIPv4([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1])).toBe("127.0.0.1");
    expect(embeddedIPv4([0x2002, 0xc0a8, 0x0101, 0, 0, 0, 0, 1])).toBe("192.168.1.1");
    expect(embeddedIPv4([0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1111])).toBeNull();
  });
});

describe("checkUrl", () => {
  it("accepts public http and https pages on the usual ports", () => {
    for (const u of [
      "https://en.wikipedia.org/wiki/Mars",
      "http://example.com/",
      "https://example.com:443/a?b=c#d",
      "http://example.com:80/",
      "https://8.8.8.8/",
      "https://[2606:4700:4700::1111]/",
      "https://arxiv.org/pdf/2401.00001",
      "https://example.com./trailing-dot",
    ]) {
      const r = checkUrl(u);
      expect(r.ok, u).toBe(true);
    }
  });

  it("refuses every other scheme", () => {
    for (const u of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "blob:https://example.com/x",
      "mailto:a@example.com",
      "tel:+441234",
      "ftp://example.com/",
      "ws://example.com/",
      "kleio://open",
    ]) {
      expect(checkUrl(u), u).toEqual({ ok: false, error: "scheme" });
    }
  });

  it("refuses malformed, protocol-relative and over-long URLs", () => {
    expect(checkUrl("//example.com/")).toEqual({ ok: false, error: "bad_url" });
    expect(checkUrl("example.com")).toEqual({ ok: false, error: "bad_url" });
    expect(checkUrl("http://")).toEqual({ ok: false, error: "bad_url" });
    expect(checkUrl("http://999.1.1.1/")).toEqual({ ok: false, error: "bad_url" });
    expect(checkUrl(`https://example.com/${"a".repeat(URL_MAX)}`)).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("refuses user names and passwords", () => {
    expect(checkUrl("http://user:pass@example.com/")).toEqual({ ok: false, error: "credentials" });
    expect(checkUrl("https://user@example.com/")).toEqual({ ok: false, error: "credentials" });
  });

  it("refuses ports other than 80 and 443", () => {
    for (const u of [
      "http://example.com:22/",
      "https://example.com:8443/",
      "http://example.com:0/",
    ]) {
      expect(checkUrl(u), u).toEqual({ ok: false, error: "port" });
    }
  });

  it("refuses private addresses however they are spelled", () => {
    for (const u of [
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0177.0.0.1/",
      "http://0x7f.0.0.1/",
      "http://0x7f000001/",
      "http://127.1/",
      "http://017700000001/",
      "http://[::1]/",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.100.100.100/",
      "http://10.0.0.1/",
      "http://[fd7a:115c:a1e0::1]/",
      "http://0.0.0.0/",
    ]) {
      expect(checkUrl(u), u).toEqual({ ok: false, error: "private_address" });
    }
  });

  it("refuses local names, decoded and without a trailing dot", () => {
    for (const u of [
      "http://localhost/",
      "http://LOCALHOST./",
      "http://%6c%6fcalhost/",
      "http://api.localhost/",
      "http://printer.local/",
      "http://metadata.google.internal/",
      "https://mac-mini-1.taila6c237.ts.net:443/",
      "http://router.home.arpa/",
      "http://intranet/",
    ]) {
      expect(checkUrl(u), u).toEqual({ ok: false, error: "local_name" });
    }
  });

  it("knows each URL's port", () => {
    const port = (u: string): number => {
      const r = checkUrl(u);
      if (!r.ok) throw new Error(r.error);
      return portOf(r.value);
    };
    expect(port("http://example.com/")).toBe(80);
    expect(port("https://example.com/")).toBe(443);
    expect(port("http://example.com:443/")).toBe(443);
  });
});

describe("resolvePublic", () => {
  /** A fake resolver that counts its lookups. */
  function fakeLookup(answers: Record<string, string[]>): { lookup: LookupAll; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      lookup: (name) => {
        calls.push(name);
        const found = answers[name];
        if (!found) return Promise.reject(new Error("ENOTFOUND"));
        return Promise.resolve(
          found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
        );
      },
    };
  }

  const name = (n: string) => {
    const h = checkHostname(n);
    if (!h.ok) throw new Error(h.error);
    return h.value;
  };

  it("looks a name up once and pins a public address, IPv4 first", async () => {
    const f = fakeLookup({
      "example.com": ["2606:2800:21f:cb07:6820:80da:af6b:8b2c", "93.184.215.14"],
    });
    expect(await resolvePublic(name("example.com"), f.lookup)).toEqual({
      ok: true,
      value: { address: "93.184.215.14", family: 4 },
    });
    expect(f.calls).toEqual(["example.com"]);
  });

  it("refuses a name when any of its addresses is private", async () => {
    const f = fakeLookup({ "mixed.example": ["93.184.215.14", "192.168.1.10"] });
    expect(await resolvePublic(name("mixed.example"), f.lookup)).toEqual({
      ok: false,
      error: "private_address",
    });
    const g = fakeLookup({ "rebind.example": ["::ffff:127.0.0.1"] });
    expect(await resolvePublic(name("rebind.example"), g.lookup)).toEqual({
      ok: false,
      error: "private_address",
    });
  });

  it("says unresolved for no answer, an error or a lookup that hangs", async () => {
    expect(await resolvePublic(name("nowhere.example"), fakeLookup({}).lookup)).toEqual({
      ok: false,
      error: "unresolved",
    });
    expect(
      await resolvePublic(name("empty.example"), fakeLookup({ "empty.example": [] }).lookup),
    ).toEqual({
      ok: false,
      error: "unresolved",
    });
    const hang: LookupAll = () => new Promise(() => {});
    expect(await resolvePublic(name("slow.example"), hang, 20)).toEqual({
      ok: false,
      error: "unresolved",
    });
  });

  it("never looks up an address", async () => {
    const f = fakeLookup({});
    expect(await resolvePublic(name("8.8.8.8"), f.lookup)).toEqual({
      ok: true,
      value: { address: "8.8.8.8", family: 4 },
    });
    expect(await resolvePublic(name("[2606:4700:4700::1111]"), f.lookup)).toEqual({
      ok: true,
      value: { address: "2606:4700:4700::1111", family: 6 },
    });
    expect(f.calls).toEqual([]);
  });

  it("refuses an IP literal before any lookup", () => {
    expect(checkHostname("[::1]")).toEqual({ ok: false, error: "private_address" });
    expect(checkHostname("10.1.2.3")).toEqual({ ok: false, error: "private_address" });
    expect(checkHostname("[not-an-address]")).toEqual({ ok: false, error: "bad_url" });
  });
});
