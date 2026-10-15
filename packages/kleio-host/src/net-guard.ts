// What the host may connect to when it fetches something for a voice show: a
// web page Kleio shows (captured as a picture) or the PDF a link points at.
// guarded-fetch.ts and capture-proxy.ts connect only through this policy.
//
// Only public addresses are reached, judged by the address a name resolves to,
// never by how it is spelled:
//   - IPv4: this network, private, carrier-grade NAT (Tailscale's 100.64/10,
//     100.100.100.100 included), loopback, link-local (cloud metadata),
//     IETF, documentation and benchmarking ranges, multicast and reserved are
//     refused.
//   - IPv6: only global unicast (2000::/3) is reached, less Teredo and the
//     IETF block (2001::/23), documentation (2001:db8::/32, 3fff::/20). So
//     ::, ::1, unique-local (fc00::/7, Tailscale's fd7a:115c:a1e0::/48),
//     link-local, multicast and the discard prefix are refused.
//   - IPv4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96) and 6to4 (2002::/16)
//     addresses are judged by the IPv4 address inside them.
// A name is resolved once per connection, every address it has is checked
// (one refused address refuses the name), and the connection goes to the
// address that was checked, so a second lookup can't rebind it.

import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, connect as netConnect, isIPv4, isIPv6, type Socket } from "node:net";
import { err, ok, type Result } from "./result.js";

/** Longest URL taken from the voice, as typed or as a redirect gives it. */
export const URL_MAX = 2048;
/** How long a name may take to resolve. */
export const LOOKUP_TIMEOUT_MS = 5_000;

/** Why a URL or an address is refused. */
export type GuardRefusal =
  | "bad_url"
  | "too_long"
  | "scheme"
  | "credentials"
  | "port"
  | "local_name"
  | "private_address"
  | "unresolved";

const V4_REFUSED: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT: Tailscale's addresses, 100.100.100.100 included
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local: cloud metadata services
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
];

const V6_REFUSED: readonly (readonly [string, number])[] = [
  // Everything outside global unicast (2000::/3): ::, ::1, IPv4-compatible,
  // the discard prefix (100::/64), unique-local (fc00::/7), link-local
  // (fe80::/10), site-local and multicast (ff00::/8). The IPv4 forms inside
  // ::/3 are judged before this list is.
  ["::", 3],
  ["4000::", 2],
  ["8000::", 1],
  ["2001::", 23], // IETF protocol assignments: Teredo (2001::/32), benchmarking, ORCHID
  ["2001:db8::", 32], // documentation
  ["3fff::", 20], // documentation
];

function blockList(
  rules: readonly (readonly [string, number])[],
  type: "ipv4" | "ipv6",
): BlockList {
  const list = new BlockList();
  for (const [net, prefix] of rules) list.addSubnet(net, prefix, type);
  return list;
}

// Built once from the tables above and never changed.
const REFUSED_V4 = blockList(V4_REFUSED, "ipv4");
const REFUSED_V6 = blockList(V6_REFUSED, "ipv6");

/** An IPv6 address's eight 16-bit groups, or null when it isn't one. */
export function ipv6Groups(ip: string): number[] | null {
  if (!isIPv6(ip) || ip.includes("%")) return null;
  let text = ip.toLowerCase();
  // A dotted IPv4 tail ("::ffff:1.2.3.4") is two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail?.[1]) {
    const v4 = tail[1].split(".").map(Number);
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string): number[] =>
    s === "" ? [] : s.split(":").map((g) => Number.parseInt(g, 16));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...new Array<number>(Math.max(0, fill)).fill(0), ...rest];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

function v4Of(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** The IPv4 address inside a mapped, NAT64 or 6to4 IPv6 address, or null. */
export function embeddedIPv4(groups: readonly number[]): string | null {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  // ::ffff:a.b.c.d
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff)
    return v4Of(g6, g7);
  // 64:ff9b::a.b.c.d (RFC 6052)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return v4Of(g6, g7);
  // 2002:aabb:ccdd::/48 (6to4)
  if (g0 === 0x2002) return v4Of(g1, g2);
  return null;
}

/**
 * Whether the host refuses to connect to `ip`. Anything that isn't a plain
 * IPv4 or IPv6 address (a scoped one, "fe80::1%en0", included) is refused.
 */
export function isRefusedAddress(ip: string): boolean {
  if (isIPv4(ip)) return REFUSED_V4.check(ip, "ipv4");
  const groups = ipv6Groups(ip);
  if (!groups) return true;
  const inner = embeddedIPv4(groups);
  if (inner !== null) return REFUSED_V4.check(inner, "ipv4");
  return REFUSED_V6.check(ip, "ipv6");
}

/** Names that only ever mean something on this Mac or its networks. */
function isLocalName(name: string): boolean {
  return (
    !name.includes(".") ||
    name === "localhost" ||
    [".localhost", ".local", ".internal", ".home.arpa", ".ts.net"].some((s) => name.endsWith(s))
  );
}

/** A hostname as the URL parser gave it: an IP literal (unbracketed) or a name. */
export type HostTarget =
  | { readonly kind: "ip"; readonly address: string; readonly family: 4 | 6 }
  | { readonly kind: "name"; readonly name: string };

/**
 * A hostname judged before any lookup: an address must be public, a name must
 * not be a local one. `hostname` is the URL parser's (canonical IPv4, IPv6 in
 * brackets, names lowercased and in punycode).
 */
export function checkHostname(hostname: string): Result<HostTarget, GuardRefusal> {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const address = hostname.slice(1, -1);
    if (!isIPv6(address)) return err("bad_url");
    return isRefusedAddress(address)
      ? err("private_address")
      : ok({ kind: "ip", address, family: 6 });
  }
  if (isIPv4(hostname)) {
    return isRefusedAddress(hostname)
      ? err("private_address")
      : ok({ kind: "ip", address: hostname, family: 4 });
  }
  const name = hostname.toLowerCase().replace(/\.$/, "");
  if (name.length === 0 || name.length > 253) return err("bad_url");
  return isLocalName(name) ? err("local_name") : ok({ kind: "name", name });
}

/**
 * A URL the voice may show, or why not: http or https only, no user or
 * password, port 80 or 443, at most URL_MAX characters, and a host that
 * isn't a private address or a local name. The WHATWG parser canonicalises
 * the host first, so decimal, octal, hex and short IPv4 spellings are judged
 * as the address they mean.
 */
export function checkUrl(raw: string): Result<URL, GuardRefusal> {
  if (raw.length > URL_MAX) return err("too_long");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err("bad_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return err("scheme");
  if (url.username !== "" || url.password !== "") return err("credentials");
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return err("port");
  if (url.href.length > URL_MAX) return err("too_long");
  const host = checkHostname(url.hostname);
  return host.ok ? ok(url) : host;
}

/** The port a checked URL connects to. */
export function portOf(url: URL): number {
  return url.port !== "" ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

/** An address that passed the policy: the only one a connection may use. */
export interface PinnedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Every address a name has (dns.lookup with `all`). */
export type LookupAll = (
  hostname: string,
) => Promise<readonly { readonly address: string; readonly family: number }[]>;

export const systemLookup: LookupAll = (hostname) => dnsLookup(hostname, { all: true });

/**
 * The one address a connection to `target` goes to, after every address the
 * name resolves to passed the policy: IPv4 first, as the Mac's own network
 * reaches it most reliably.
 */
export async function resolvePublic(
  target: HostTarget,
  lookup: LookupAll = systemLookup,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<Result<PinnedAddress, GuardRefusal>> {
  if (target.kind === "ip") return ok({ address: target.address, family: target.family });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  let found: readonly { readonly address: string; readonly family: number }[] | null;
  try {
    found = await Promise.race([lookup(target.name), timeout]);
  } catch {
    found = null;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!found || found.length === 0) return err("unresolved");
  if (found.some((a) => isRefusedAddress(a.address))) return err("private_address");
  const pick = found.find((a) => isIPv4(a.address)) ?? found[0];
  if (!pick) return err("unresolved");
  return ok({ address: pick.address, family: isIPv4(pick.address) ? 4 : 6 });
}

/** Opens a TCP connection to an address that passed the policy. */
export type Connector = (target: PinnedAddress & { readonly port: number }) => Socket;

/** The real connector: straight to the checked address, no lookup of its own. */
export const connectPinned: Connector = (target) =>
  netConnect({ host: target.address, port: target.port, family: target.family, noDelay: true });

/** Words for a refusal, for the panel and the voice. */
export function refusalText(r: GuardRefusal): string {
  switch (r) {
    case "bad_url":
      return "That isn't a web address.";
    case "too_long":
      return "That web address is too long.";
    case "scheme":
      return "Only http and https pages can be shown.";
    case "credentials":
      return "Web addresses with a user name or password in them can't be shown.";
    case "port":
      return "Only pages on the usual web ports can be shown.";
    case "local_name":
    case "private_address":
      return "That page is on a private network, so it can't be shown.";
    case "unresolved":
      return "Couldn't find that site.";
  }
}
