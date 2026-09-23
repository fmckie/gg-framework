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
receives `{ baseUrl, host, token, label, deviceId, controlCredential? }`. Every later
request carries `x-kleio-device-token` (admin devices add `x-kleio-control`).
`GET /events?session=…` frames carry `id:`; reconnect with `Last-Event-ID` and the
host replays what was missed (persisted ring, survives a host restart). Revoking a
device closes its open streams immediately.

### From gg-app (the laptop)

1. On the mini: `node kleio-host/dist/cli.js pair --admin` → `ABC-DEF`.
2. In gg-app: **⌘⇧K** → host URL (`https://mac-mini-1.<tailnet>.ts.net:8443`) + the
   code → **Pair** → **Restart now**.
3. The title strip shows **on mac-mini-1**; sessions now run there. The picker lists
   the mini's projects; "New project" points you at the mini.

The token and control credential go to the login Keychain (`com.kleio.gg-app`), the
non-secret record to `~/.gg/kleio-remote.json`. Admin actions in the pane's
**Devices** tab (list, revoke, mint a code) ask for Touch ID once per 15 minutes and
refuse without it. **Forget host** + restart returns to local mode. Env override for
development: `KLEIO_HOST_URL` + `KLEIO_DEVICE_TOKEN` (+ `KLEIO_CONTROL_CREDENTIAL`).

### Headless and macOS privacy prompts

The host runs its sidecar with `GG_APP_HEADLESS=1`. Under launchd, reading
`~/Desktop`, `~/Documents` or `~/Downloads` — even a `stat()` of a path below them —
blocks on a "would like to access" dialog nobody at a headless Mac can answer, and
each blocked call pins a libuv thread. With the flag, project discovery never touches
those folders; keep the mini's projects under its projects root (default
`~/gg-projects`) instead.

## Known limits

- The sidecar buffers nothing: deltas emitted while the proxy itself is down (≈0.1 s
  on a redeploy) are not recoverable. `KeepAlive` keeps that window small.
- The sidecar's `cwd` is a host path; a remote client must pick a project that exists
  on the mini.
- Sessions are tracked from creation _through the proxy_; a session created by some
  other client of the sidecar is not ring-buffered until a proxied client attaches.
