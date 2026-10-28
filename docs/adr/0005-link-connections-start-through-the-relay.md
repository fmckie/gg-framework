# ADR 0005: Link connections start through the relay

**Status:** Accepted, 2026-10-28. Amends ADR 0004.

## Context

ADR 0004 left two ways to learn the host's current addresses. Both are on the link endpoint
(`kleio/http/0`):

- **A revoked key still completed its handshake,** so it could be told `REVOKED`.
- **A direct dial got its handshake.** Anyone who already knew one of the host's addresses, from
  a v4 QR code say, could dial `kleio/http/0` there and complete it.

iroh 1.4.1 sends every connection whose handshake completes the endpoint's direct addresses,
before the gate runs. This is what the host can know before a handshake, read in the source of
iroh 1.4.1 and noq 1.4.0:

- **A direct dial names no key.**
  - A connection a relay brings names the key the relay took it from (`IncomingAddr::Relay`). A
    direct one has only an address (`IncomingAddr::Ip`).
  - The client's key reaches the host only in its TLS Certificate message. That's the client's
    second flight, after the host has sent its own.
  - iroh sends no SNI, and the one it used to send named the server's key, not the client's.
- **Nothing holds the addresses back from one connection.** iroh registers a connection, which
  adds the endpoint's direct addresses as NAT-traversal candidates, before any `after_handshake`
  hook runs. `max_remote_nat_traversal_addresses` ignores any value under 8.
- **A refusal before the handshake says nothing an app reads.** `Incoming::refuse()` sends only
  QUIC's transport error `CONNECTION_REFUSED`. RFC 9000 §10.2.3 bars application closes from
  Initial and Handshake packets.
- **A dialling iroh sends a copy of its first packet to every path it knows.**
  - That's the relay and each direct address, until one path is selected.
  - noq takes the first copy to arrive as the connection, and the client takes the answer from
    whichever copy gets one.
  - If the host ignores a direct copy, nothing is sent and the copy is forgotten. The relay's copy
    then comes in as a new connection, which names the key. Refusing the direct copy would end
    the whole attempt.
- **A revoked device dials direct too.** It keeps the addresses `GET /kleio/link` gave it, and on
  the home network its direct copy arrives first. So refusing revoked keys only when a relay
  brings them doesn't stop it.

## Decision

While the link endpoint is on a relay, it takes a new connection only through the relay, which
names the key, and only from a paired key. The pairing endpoint tells a key where it stands.

### The link endpoint decides before the handshake

`admit`, in `packages/kleio-link/src/host/mod.rs`:

| How it comes  | Key            | Link endpoint on a relay now | What happens                                |
| ------------- | -------------- | ---------------------------- | ------------------------------------------- |
| Through relay | paired         | either                       | Handshake; the gate lets it in, as before.  |
| Through relay | revoked, never | either                       | Refused before the handshake.               |
| Direct        | not knowable   | yes                          | Ignored: no answer at all. Logged at debug. |
| Direct        | not knowable   | no                           | Handshake; the gate closes it with 1 or 5.  |

- **A connected device still goes direct.** Hole punching adds paths to its open connection,
  which noq routes by connection ID. It never makes a new connection.
- **"On a relay"** is the link endpoint's home relay status, read for each new connection.
  Refusing and ignoring both happen before the limit on connections not yet known to be paired.
- **With no relay** (the host's internet or its relay is down, or it has just started), a direct
  dial gets its handshake as before. So a phone on the host's Wi-Fi still reaches it when the
  internet is out.
- The pairing endpoint is unchanged: through the relay only, any key.

### The pairing endpoint says where a key stands

- It takes a new protocol, `kleio/standing/0`, beside `kleio/pair/0`.
- The gate answers right after the handshake, with no stream, by closing:
  - 6, `PAIRED`, for a key on the allow-list (a new code);
  - 5, `REVOKED`, for a revoked device's key;
  - 1, `NOT_PAIRED`, for a key that was never paired.
- That endpoint has no address (ADR 0004), so the handshake gives nothing away.
- It shares the limit on connections not yet known to be paired. That's no new load: any key can
  already open `kleio/pair/0` handshakes there.

### The app asks after a dial the host refused

In `packages/kleio-link/src/link.rs`, a dial refused before its handshake asks the pairing key on
`kleio/standing/0`, through the route's relays only, for up to 4 s:

- **5 or 1** is `Revoked` or `NotPaired`. The link holds it, as it holds those answers from the
  link endpoint, so the app says the device was removed, or that the host doesn't know it, and
  never dials again.
- **6, no answer, or a host without the protocol** fails as a dial that found no host does. That
  isn't held: the next use dials again.

A refusal from either stage of a dial ends the dial at once, so the question is asked once.

### The app dials through the relay first

- While this device has a relay connection, a dial's first stage is the host's relay alone. A
  direct copy would only be ignored, and if it arrived just before the relay copy, from a relay
  close to the host, the two would be dropped together and cost a resend.
- While it has none, just after launch or with the internet down, the first stage names the
  direct addresses too, so the fallback on the home network is immediate. The relay copy follows
  only once the relay connects again, so the two don't race.
- The second stage names every relay and the direct addresses, as before.

### Where the app gets the pairing key

- A v5 ticket gives it. A v4 ticket gives none.
- kleio-host's `GET /kleio/link` adds `pairKey`, which also covers devices paired before this
  change once they connect again.
- gg-app keeps it in `link.json` as `pairKey`, an optional field. Older records load without it.
  Older builds ignore it, and drop it if they rewrite the file; the next `GET /kleio/link` gives
  it again.

### Older apps and hosts

kleio-host and kleio-link-host ship together, as ADRs 0003 and 0004 set. Ship the app first, so
devices are told "removed" from the day the host updates.

| App \ host              | Host before this change                                                          | Host after                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| App before, allowed     | As before                                                                        | Works. Each new connection starts through the relay, then goes direct.                                                                                |
| App before, revoked     | Told "removed" after the handshake (the leak)                                    | Removed while connected: told "removed" by the close, as before. Otherwise each dial is refused before the handshake, so it says "asleep or offline". |
| App after, revoked      | Told "removed" after the handshake, as before                                    | Refused before the handshake, then told "removed" by the pairing endpoint.                                                                            |
| App after, never paired | Asks, but the old pairing endpoint lacks the protocol: a refused dial, as before | Told the host doesn't know this device, which fixes ADR 0004's first consequence.                                                                     |

### Tests

`packages/kleio-link/tests/relayed.rs` gives the host loopback addresses, as ADR 0004's tests do.
Two tests failed on the old host, where the handshake completed: a revoked phone that kept the
host's address, and a stranger that knew it. Three more check the pairing endpoint's answers, an
allowed phone that starts through the relay and then goes direct, and the host taking direct
dials while it's on no relay.

## Rejected alternatives

- **Accept and document the two gaps.** Refusing revoked keys only when a relay brings them isn't
  worth doing alone: a revoked device's direct copy still gets the handshake.
- **Letting direct dials in by source IP.** That's an address, not a key, and households and
  mobile networks share addresses.
- **Turning off NAT traversal for some connections.** iroh enforces at least 8 addresses.
- **An ALPN marker for new apps.** An attacker would leave it out.
- **Keeping the revoked key's handshake for old apps.** That is the leak.
- **QUIC address-validation tokens.** They're tied to an IP, and revoked devices hold them too.
- **Patching iroh,** already rejected in ADR 0004.

## Consequences

- **With no relay** (an outage, or the first second after start), a direct dial gets its
  handshake as before. Someone who can reach one of the host's addresses then sees the others.
- **A device that reaches no relay, while the host is on one,** can't open a new link connection,
  even with a direct path. A connection already open keeps working.
- **New connections on a home network** wait for the relay's round trips before going direct.
  This isn't measured yet; ADR 0002 saw most Wi-Fi connections go direct within 0.1 s. Check it on
  the iPhone.
- **Older revoked apps aren't told "removed",** and nor is a device revoked before it learned the
  pairing key. They say "asleep or offline" and dial again on each use, which costs the host one
  refused packet through the relay each time.
- **A restored snapshot that gets a new `link-pair.key`** makes the pairing keys devices kept
  stale. Until `GET /kleio/link` gives a device the new one, a dial the host refuses fails as one
  that found no host.
- **The question's 4 s come out of the dial's 10 s,** so a refusal late in the second stage can
  end as a timeout.
- **It relies on iroh copying the first packet to every path, and on noq's grouping of the
  copies.** Both are read from the source, not documented. The tests above pin them, and
  `check-link-locks` keeps both lockfiles on iroh 1.4.1.
- From ADR 0004: the host still sees the phone's addresses, and v4 QR codes already shown can't be
  recalled. While the host is on a relay, their addresses now get no answer.
