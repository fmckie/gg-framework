# ADR 0003: Every pairing over the link waits for an admin's Allow

**Status:** Accepted, 2026-10-27

## Context

A pairing code is live for up to 5 minutes, shown as a QR code. Over the link, anyone who sees a
live code (over a shoulder, on a shared screen, in a screenshot) can pair a device from anywhere,
and a paired device can run commands on the host. Admins hear of it only through a push alert, and
only where push is set up. The security review calls this BP-001.

The production plan for Kleio's link (`.gg/plans/kleio-link-production.md`, a local plan) listed
"an admin approving each pairing" as not in that plan. It relied on the code being single use, its
5 tries, the pairing budget and the admin push.

Projects where the trusted side shows the code and the newcomer joins with it (KDE Connect,
Tailscale device approval, LocalSend, WhatsApp's phone-number flow) ask someone on the trusted side
first, and show something the newcomer can't fake. Signal and WhatsApp's QR flow don't ask,
because there the trusted phone scans the newcomer. Kleio's QR code works the other way.

## Decision

Every pairing over the link needs an admin's **Allow** before the host creates the device or its
token.

- The new device sends its code, then waits. The host reserves the code for that device's link key
  and nonce, and answers `pending` until an admin decides. The device gives up after 2 minutes.
- The admin showing the code sees the device's name and its device code (the first 6 hex
  characters of its link key, which the device shows too), with **Allow** and **Deny**.
  `kleio-host pair` asks the same in a terminal.
- **Deny**, closing the code, or the code expiring retires it as `denied`. Another device trying
  the same live code is turned away as `claimed`.
- Approval is once per pairing. Later connections use the allow-list as before.
- Each completed pairing is logged on the host, pushed where push is set up, and shown on admin
  devices as "New device paired" until someone dismisses it.
- Pairing over the user's own network (off the link) is unchanged.
- The host refuses a link pairing from an app too old to wait (`update_required`), so kleio-host,
  kleio-link-host and the app's link code ship together.

This replaces the line in the link production plan that left admin approval out. It adds to ADR
0002 and changes nothing in it.

## Rejected alternatives

- **Tell admins afterwards, more loudly.** The device would already hold a token by the time
  anyone reads the notice. The notice is kept, as a second line.
- **Hold one connection open until the admin decides.** kleio-link-host gives kleio-host 10 seconds
  and the whole exchange 15, the app gives pairing 20, and the host takes one pairing exchange at
  a time. A person can't be relied on to answer within those, so the device asks again instead.
- **The admin's device scans the newcomer (Signal's direction).** It needs a new pairing flow on
  every device and a camera on the admin's side. Not in this change.
