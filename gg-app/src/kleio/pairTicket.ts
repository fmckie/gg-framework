// The pairing ticket the Kleio iPhone app reads from a QR code: the host's
// address and a one-time pair code — never a token. The phone still redeems
// the code over HTTPS, and the code is single-use and expires in minutes, so a
// photo of the ticket is worth no more than the code shown beside it.
//
// The rules mirror the phone's reader (atlas-ios PairingQRCode.swift): v2,
// type "kleio-pair", an https tailnet address with nothing but a port, and a
// six-character code. A ticket the phone would refuse is never drawn.

export type TicketResult = { ok: true; value: string } | { ok: false; error: string };

const MAX_HOSTNAME = 253;
const HOSTNAME = /^[A-Za-z0-9.-]+$/;

export function pairTicket(baseUrl: string, code: string): TicketResult {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { ok: false, error: "The Mac mini's address isn't a valid link." };
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
  const compact = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 6) return { ok: false, error: "That pair code isn't six characters." };
  const ticket = {
    v: 2,
    type: "kleio-pair",
    baseUrl: `https://${host}${url.port ? `:${url.port}` : ""}`,
    code: `${compact.slice(0, 3)}-${compact.slice(3)}`,
  };
  return { ok: true, value: JSON.stringify(ticket) };
}
