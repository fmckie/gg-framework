# ADR 0002: Kleio's own link (iroh) replaces Tailscale

**Status:** Accepted, 2026-10-22

## Context

Every device reaches the Kleio host over Tailscale, signed in to the same account:

- A new user installs Tailscale and makes an account before Kleio's own setup starts. A VPS also
  needs `tailscale up` and HTTPS certificates turned on in the tailnet.
- On the iPhone, Tailscale's app is a VPN, which clashes with another VPN the user runs, and Kleio
  can't read its state, so it guesses from how a request failed.
- A host's node key expires, and the host drops off until someone signs it in again.
- Most of the app's connection troubleshooting is about Tailscale.

A prototype ran from 2026-10-16 to 2026-10-22 to decide whether Kleio should connect devices to the
host itself: iroh 1.3.0, a forwarder on the Mac mini host, the test iPhone, and n0's public relay.

## Decision

Kleio's link, built on iroh from n0, is the default connection for every host: desktop, laptop and
VPS. The same QR code pairs all of them.

- Devices dial the host by its public key. Connections are QUIC, end-to-end encrypted, and
  mutually authenticated by key. A relay passes them on and can't read them.
- The host side is its own program, `kleio-link-host` (`packages/kleio-link`), beside kleio-host,
  which keeps listening on 127.0.0.1 only. Only paired devices' keys reach kleio-host.
- The phone finds the host from its pairing ticket alone. iroh's address lookup (pkarr and DNS
  discovery) stays off.
- Relays: n0's public relays by default, a relay of the user's own as a setting, and a built-in
  relay for VPS hosts. We contact n0 about their relays before launch.
- Tailscale, or any network the user runs, stays available as "connect over your own network".
- iroh is pinned, and gg-app's and the link's lockfiles move together (`.github/dependabot.yml`,
  `scripts/check-link-locks.mjs`).

## What the prototype measured

- **Reach.** On EE 4G the reply arrived through the relay (connected in 2.13 s, and 0.66 s in Relay
  only). EE never went direct, in 0 of 11 connections, and neither did Tailscale. Every Wi-Fi
  connection the log could see went direct, 10 of 10 with Tailscale off, most within 0.1 s.
  Overall, 73% of the phone's connection time went through the relay.
- **Back from the background.** 4 of 4 returns caught up by themselves (73 ms, 510 ms, 32.1 s and
  158 ms), with nothing missing or doubled. The 32.1 s was a stale connection the app trusted. It
  was fixed on 2026-10-22: after being away for at least the host's idle timeout (30 s), the app
  closes the connection and dials again. Checked once on the phone, it redialled in 0.45 s.
- **A long chat and downloads through n0's relay** (scripted, from a laptop client): two
  13.5-minute streams with no gap over 10 s, and a 667-message chat opened in 0.57 s and 0.88 s.
  The relay throttled downloads to about 1.06 MB/s after the first 5 MiB (2.12 MB/s): 45 MiB took
  44.5–44.7 s.
- **Pairing by QR code.** One good pairing, and all 9 must-fail cases failed.
- **Direct with incoming connections blocked:** yes, so a VPS installer can block them.
- **App size:** +3.08 MB on the iPhone app.
- **Not measured:** battery, a second other Wi-Fi network, and the long-chat test in the real app.
  There's no Tailscale baseline, so nothing here is faster or slower than Tailscale.

By its own rule the prototype hadn't fully passed: one criterion was inconclusive, one wasn't
measured, and two passed only by their written rules. None failed. The decision was to go ahead on
conditions: fix the stale connection (done), decide the relay (above), measure what wasn't measured
or accept it as unknown, make pairing errors say what they can tell, and keep previews in Safari
over Tailscale until an in-app view exists.

## Rejected alternatives

- **Tailscale inside the app (TailscaleKit).** No Tailscale app and no VPN prompt, but every device
  still signs in to Tailscale, and there's no published binary to depend on.
- **A public address or a tunnel service.** A tunnel service such as Cloudflare Tunnel ends TLS on
  its own servers, so it can read the traffic. An open port puts the host on the internet, which is
  how tens of thousands of OpenClaw gateways leaked API keys and chat histories in 2026.
- **Our own Headscale, or our own relay protocol.** Headscale would make us the key server for
  every user. A relay protocol of our own would mean writing our own encryption.

## Consequences

- **n0's public relays are shared and rate-limited,** about 1 MB/s as measured, and most mobile
  traffic goes through a relay. A user's own relay, the built-in VPS relay, and their own network
  are the ways around them.
- **Push notifications aren't end-to-end encrypted.** Apple delivers them, and they quote part of
  a reply. The app and docs say so, and a host setting leaves the text out.
- **Without address lookup, a host that moves relay can't be found** from an old ticket. So the
  host pins its relay and fails over in a fixed order, and phones keep the host's list of relays.
- **The tailnet no longer stands in front of pairing.** Anyone with a photo of a live QR code can
  pair within its 5 minutes, so codes stay single-use with 5 tries, and admin devices are told of
  every new pairing.
- **Previews still open in Safari over Tailscale** until a native in-app view is built.
- **iroh upgrades touch two lockfiles,** gg-app's and the link's. CI fails until they agree.
