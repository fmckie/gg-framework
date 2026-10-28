# ADR 0004: No device learns the host's addresses before an admin's Allow

**Status:** Accepted, 2026-10-28

## Context

ADR 0003 made every pairing over the link wait for an admin's Allow. A device still learned where
the host is before that Allow. The security review calls this BP-002.

- **The QR code.** The pairing ticket (v4) carried up to two of the host's direct addresses,
  public IPv4 first. Anyone who saw it learned the home's public IP and the host's LAN address
  without connecting.
- **Connecting to pair.** Anyone with a ticket, live or long expired, could connect on
  `kleio/pair/0` with any key and any code, or none. iroh 1.4.1 sends every connection the
  endpoint's direct addresses as NAT-traversal candidates once its handshake completes. That is
  before the `after_handshake` hook where kleio-link-host's gate runs. The list covers every
  interface the host has (LAN, IPv6, Tailscale, VPN, Docker) and the public addresses its relay
  sees, up to 32. If the peer asks, the host also probes the peer's addresses from its own socket,
  which shows the host's address outside its router.
- **It kept working.** A code expires but the ticket's key and relay don't, so an old QR code
  found the host's new addresses after it moved network.
- **Connecting to the link.** A stranger dialling `kleio/http/0` got the same addresses before the
  gate closed the connection.

The HTTP answers leaked nothing: a waiting device gets no address in any of them. No test caught
the rest, because every link test ran the host relay-only, and production runs it with direct
paths.

iroh 1.4.1 can't hold its addresses back from some connections of one endpoint. Hole punching
can't be turned off per connection, `addr_filter` only filters what address lookup publishes, and
no hook runs before the addresses go out. A second endpoint can't share the key, because a relay
keeps only the newest connection for each key.

## Decision

Pairing moves to an endpoint of its own on the host, one with no address to give. A device learns
the host's addresses only once an admin has allowed it.

- kleio-link-host runs two endpoints, on the same relay:
  - The **link endpoint** (`secure/link.key`) takes `kleio/http/0` only and goes direct when it
    can, as before.
  - The **pairing endpoint** (`secure/link-pair.key`) takes `kleio/pair/0` only. It is always
    relay-only: it binds no socket and has no address. It has the same gate, pairing budget and
    limit on connections not yet paired. kleio-host makes its key alongside `link.key`, and
    kleio-link-host won't start if the two keys are the same.
- The pairing ticket is v5:
  `{"v":5,"type":"kleio-pair","name":…,"key":…,"pair":…,"relays":[…],"code":…}`.
  - `key` is the host's link key. The app connects to it after pairing, and the confirm step shows
    its start.
  - `pair` is the pairing endpoint's key. The app uses it only to pair.
  - There is no `addrs` field, and a v5 ticket that has one is refused. Default tickets stay under
    the 300-byte QR budget.
- The link endpoint refuses, before its handshake, a connection that a relay brings from a key it
  doesn't know. The relay names that key. The gate still checks the handshake's key on every
  connection it lets through. A revoked key still gets its handshake, so it can be told `REVOKED`.
- After the Allow, the app connects to `key` through the relay and goes direct when it can. It
  keeps the addresses `GET /kleio/link` gives it for its next launch, as before.
- `link/state.json` adds `pairKey` and `pairRelay`. kleio-host makes a ticket only while the
  pairing endpoint is on a relay.
- The app still reads v4 tickets from hosts not yet updated. An older app refuses a v5 ticket and
  asks to be updated. kleio-host, kleio-link-host and the app's link code ship together, as ADR
  0003 set.
- Pairing over the user's own network (off the link) is unchanged. A device pairing there has
  already reached the host.

Two tests in `packages/kleio-link/tests/relayed.rs` give the host loopback addresses. They check
that neither a waiting phone nor a stranger with a ticket sees one of them before the Allow. Both
saw one on the old host.

This adds to ADRs 0002 and 0003 and changes nothing in them.

## Rejected alternatives

- **The phone pairs relay-only.** The host sends its addresses whatever the phone does, and a
  stranger can run any iroh client.
- **The whole host relay-only.** That ends direct paths for allowed devices too. ADR 0002 measured
  Wi-Fi going direct in 10 of 10 connections, and n0's relays at about 1 MB/s.
- **A second endpoint with the same key.** A relay keeps only the newest connection for a key, so
  the two endpoints would push each other off it.
- **Only the pairing key in the ticket, and the link key in the pairing answer.** That changes the
  answer as well as the ticket, and the confirm step couldn't show the key the app will connect
  to.
- **A new pairing key for each code.** It gains nothing. The pairing endpoint has no address to
  give, and its key tells a stranger only the relay, which the ticket names anyway. It would also
  mean a new endpoint and relay connection for each code.
- **Patching iroh** so that some connections get no addresses. That would be a fork of iroh and
  its QUIC stack, carried through every upgrade in both lockfiles.

## Consequences

- **A stranger through a relay sees a refused connection,** not "Your host doesn't know this
  device". A real device sees that only after its host has lost its list of devices, which is
  rare.
- **A revoked device still completes a handshake** to be told it was removed, and may see the
  host's current addresses before the gate closes the connection. It was allowed once.
- **Someone who already knows one of the host's addresses,** from a v4 QR code say, can still dial
  it directly, complete a handshake and see the host's other addresses before the gate turns them
  away. QR codes already shown can't be recalled.
- **The host still sees the phone's addresses** while it pairs.
- **A relay of the user's own on the host machine names that machine** in every ticket, by design.
- **The host holds two relay connections.** The pairing one is idle except while a device pairs.
  Relay failover moves both together.
- **The first connection after pairing goes through the relay,** then direct when it can, within
  about 0.1 s on Wi-Fi in ADR 0002's measurements.
- **Upgrading:** kleio-host makes `link-pair.key` the first time `serve` runs after the update.
  Until then kleio-link-host stops at start for the missing key, as it does for a missing
  `link.key`.
