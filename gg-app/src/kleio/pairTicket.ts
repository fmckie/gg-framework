// The pairing ticket the Kleio iPhone app reads from a QR code: the host's
// address and a one-time pair code — never a token. The phone still redeems
// the code over HTTPS, and the code is single-use and expires in minutes, so a
// photo of the ticket is worth no more than the code shown beside it.
//
// The rules mirror the phone's reader (atlas-ios PairingQRCode.swift): v2,
// type "kleio-pair", an https tailnet address with nothing but a port, and a
// six-character code. A ticket the phone would refuse is never drawn.
//
// `readTicket` is the reading side, for a scanned or pasted ticket. A v2
// ticket fills the pairing form; a v3 ticket (the connection prototype's
// Kleio link: the host's key, its relay and the code) goes to the link's
// confirm step, where Rust's check of it (prototypes/kleio-link) decides.

export type TicketResult = { ok: true; value: string } | { ok: false; error: string };

/** What a scanned or pasted ticket leads to. */
export type TicketRoute =
  /** Fill the pairing form with these. */
  | { kind: "v2"; baseUrl: string; code: string }
  /** Show the link's confirm step for this ticket. */
  | { kind: "v3"; ticket: string }
  | { kind: "invalid"; error: string };

/** What anything that isn't a ticket gets, and it fills nothing. */
export const NOT_A_TICKET = "That isn't a Kleio pairing code.";

const MAX_HOSTNAME = 253;
const HOSTNAME = /^[A-Za-z0-9.-]+$/;
/** The link's own cap on a ticket (MAX_TICKET_BYTES in ticket.rs). */
const MAX_TICKET_BYTES = 1024;
/** `ABC-DEF` in the host's pair alphabet, which leaves out I, L, O and U. */
const PAIR_CODE = /^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/;
const V2_FIELDS = "baseUrl,code,type,v";

/** `https://<host>[:port]`, if `baseUrl` is an https tailnet address with
 *  nothing but a port. */
function tailnetBase(baseUrl: string): { ok: true; base: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { ok: false, error: "The host's address isn't a valid link." };
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    !host.endsWith(".ts.net") ||
    host.length > MAX_HOSTNAME ||
    !HOSTNAME.test(host)
  ) {
    return { ok: false, error: "The iPhone app only pairs with a Tailscale (.ts.net) address." };
  }
  return { ok: true, base: `https://${host}${url.port ? `:${url.port}` : ""}` };
}

export function pairTicket(baseUrl: string, code: string): TicketResult {
  const base = tailnetBase(baseUrl);
  if (!base.ok) return base;
  const compact = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 6) return { ok: false, error: "That pair code isn't six characters." };
  const ticket = {
    v: 2,
    type: "kleio-pair",
    baseUrl: base.base,
    code: `${compact.slice(0, 3)}-${compact.slice(3)}`,
  };
  return { ok: true, value: JSON.stringify(ticket) };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Where a scanned or pasted ticket leads. A v2 ticket must be exactly what
 * `pairTicket` writes: its four fields, an https tailnet address with nothing
 * but a port, and `ABC-DEF` in the pair alphabet. A v3 ticket is passed on
 * whole, for Rust to check. Anything else is refused and fills nothing.
 */
export function readTicket(text: string): TicketRoute {
  const invalid: TicketRoute = { kind: "invalid", error: NOT_A_TICKET };
  const raw = text.trim();
  if (raw === "" || new TextEncoder().encode(raw).length > MAX_TICKET_BYTES) return invalid;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid;
  }
  if (!isRecord(parsed) || parsed.type !== "kleio-pair") return invalid;
  if (parsed.v === 3) return { kind: "v3", ticket: raw };
  if (parsed.v !== 2 || Object.keys(parsed).sort().join(",") !== V2_FIELDS) return invalid;
  const { baseUrl, code } = parsed;
  if (typeof baseUrl !== "string" || typeof code !== "string" || !PAIR_CODE.test(code)) {
    return invalid;
  }
  const base = tailnetBase(baseUrl);
  return base.ok ? { kind: "v2", baseUrl: base.base, code } : invalid;
}
