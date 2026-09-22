# @kleio/host

Runs the unmodified gg-app sidecar on a headless Mac and fronts it over Tailscale
for paired devices. Private workspace package; not published.

```
laptop / phone ──HTTPS (tailscale serve :8443)──▶ kleio-host serve ──HTTP loopback──▶ app-sidecar.mjs
                                                   │ device tokens, pairing,            ▲
                                                   │ SSE id + replay ring               │ supervised by
                                                   └──────────── sidecar.json ◀──── kleio-host sidecar
```

Two launchd jobs (`com.kleio.host.sidecar`, `com.kleio.host.serve`) so the proxy can
be redeployed without killing a run. State lives under
`~/Library/Application Support/Kleio/host` (see `src/paths.ts`).

## Install on the mini

```sh
# laptop
node gg-app/scripts/bundle-sidecar.mjs
pnpm --filter @kleio/host build
rsync -az --delete packages/kleio-host/dist/   mini:kleio-host/dist/
rsync -az          packages/kleio-host/scripts/install-mini.sh mini:kleio-host/
rsync -az --delete gg-app/src-tauri/sidecar/    mini:kleio-host/sidecar/
# mini
sh kleio-host/install-mini.sh          # idempotent; `uninstall` to remove jobs
```

The installer retires the earlier `com.kleio.*` / `com.atlas.*` / `com.hermes.*` /
`com.noledge.*` user agents (plists moved to `LaunchAgents/retired-by-kleio-host/`),
creates keys and the first admin device, and points `tailscale serve --https=8443` at
the host. Root-owned leftovers under `/Library/LaunchDaemons` are unloaded if `sudo -n`
allows it; otherwise they are listed with the one `sudo mv` to run (they are disabled
in launchd and cannot start, so this is cleanup, not a blocker).

## Pair a device

```sh
node kleio-host/dist/cli.js pair            # prints ABC-DEF, 5 min, single use
node kleio-host/dist/cli.js pair --admin    # also grants a control macaroon
node kleio-host/dist/cli.js devices
node kleio-host/dist/cli.js revoke <deviceId>
```

The device POSTs `{ code, redemptionNonce, label }` to `/kleio/pair/redeem` and
receives `{ baseUrl, host, token, label, deviceId }`. Every later request carries
`x-kleio-device-token`. `GET /events?session=…` frames carry `id:`; reconnect with
`Last-Event-ID` and the host replays what was missed (persisted ring, survives a host
restart). Revoking a device closes its open streams immediately.

## Known limits

- The sidecar buffers nothing: deltas emitted while the proxy itself is down (≈0.1 s
  on a redeploy) are not recoverable. `KeepAlive` keeps that window small.
- The sidecar's `cwd` is a host path; a remote client must pick a project that exists
  on the mini.
- Sessions are tracked from creation _through the proxy_; a session created by some
  other client of the sidecar is not ring-buffered until a proxied client attaches.
