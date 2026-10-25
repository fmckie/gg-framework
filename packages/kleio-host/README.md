# @kleio/host

Runs the fork's gg-app sidecar on a headless Mac and serves it to paired devices: over Kleio's
link, through `kleio-link-host` ([packages/kleio-link](../kleio-link/README.md)), and over
Tailscale for devices paired that way. Private workspace package; not published. The sidecar
carries two engine changes Kleio relies on (persisted routines and `GG_APP_HEADLESS`); see the
header of `src/host.ts`.

```
phone ──QUIC, end-to-end (iroh: a relay, or direct)──▶ kleio-link-host
                                                        │ paired keys only; TCP loopback :8445,
                                                        ▼ opening KLEIO-LINK/1 <device key> <secret>
laptop / phone ──HTTPS (tailscale serve :8443)──▶ kleio-host serve ──HTTP loopback──▶ app-sidecar.mjs
                                                   │ device tokens, pairing,            ▲
                                                   │ SSE id + replay ring               │ supervised by
                                                   └──────────── sidecar.json ◀──── kleio-host sidecar
browser on the device ──HTTPS (tailscale serve :8444)──▶ kleio-host serve, preview origin only
```

Three listeners, all on 127.0.0.1: kleio-host refuses any other address. On a host with
Tailscale, Tailscale Serve fronts the first two (tailnet only, never Funnel). The third takes only
kleio-link-host:

| Port   | Env                                       | Serves                                                                                 |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `8443` | `KLEIO_HOST_PORT`, `KLEIO_PUBLIC_URL`     | The API. A paired device's token on all but health, pairing and the Composio callback. |
| `8444` | `KLEIO_PREVIEW_PORT`, `KLEIO_PREVIEW_URL` | Agent-written web pages, by short-lived link only. No API routes.                      |
| `8445` | `KLEIO_LINK_PORT`                         | The same API, for devices paired over the link (see [Kleio's link](#kleios-link)).     |

`KLEIO_PREVIEW_URL` defaults to `KLEIO_PUBLIC_URL` with the preview port. Both are optional. A host
without `KLEIO_PUBLIC_URL` is reached over the link only. It has no site previews, which need
Tailscale for now, and its Apps sign-in ends on Composio's own page, as any sign-in started over the
link does.

As a guard against DNS rebinding, a listener answers a request only when its `Host` header names
one of the listener's addresses, before reading anything else:

- **The API (8443):** `127.0.0.1`, `localhost` or `[::1]` at its port, or `KLEIO_PUBLIC_URL`'s name
  and port. A device paired by address keeps `KLEIO_PUBLIC_URL` as its address, so a proxy in front
  of the API has to pass that `Host` on, as Tailscale Serve does.
- **The link (8445):** `link.kleio.invalid`, which the app and kleio-link-host send, or `127.0.0.1`
  at its port.

Any other name gets 421 and a request with no `Host` gets 400. Each value refused is logged once.

Three launchd jobs: `com.kleio.host.sidecar`, `com.kleio.host.serve`, and `com.kleio.host.link`,
which runs kleio-link-host. So the proxy can be redeployed without killing a run, and a deploy that
leaves kleio-link-host as it was leaves phones connected over the link.

State lives in one folder (`src/paths.ts` has the layout). `KLEIO_HOST_HOME` overrides it;
otherwise it is the OS's own place:

| OS                 | State folder                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| macOS              | `~/Library/Application Support/Kleio/host`                                                        |
| Windows            | `%LOCALAPPDATA%\Kleio\host`; `<home>\AppData\Local\Kleio\host` when `LOCALAPPDATA` isn't absolute |
| Linux and the rest | `$XDG_STATE_HOME/kleio/host`; `~/.local/state/kleio/host` when that is unset or not absolute      |

The secrets in it are `secure/` (the master key, control root key, `admin.token`, device registry,
and the link's `link.key`, `link-upstream.token` and `link-allow.json`), the API key files beside
it (`composio.key`, `typesafe.key`, `openai.key`) and `sidecar.json`. On macOS and Linux they are
0700 and 0600. On Windows they are locked to the host's user instead (see
[Windows: secrets and stopping](#windows-secrets-and-stopping)). Two more sit beside them, and
aren't secret:

- **`node-id`** is the name admin credentials are bound to, settled once. It's `KLEIO_PUBLIC_URL`'s
  host name if there was one, so credentials minted over Tailscale keep working without it.
  Otherwise it's a name made from the link's key.
- **`link/`** holds the relay list (`config.json`) and where kleio-link-host is (`state.json`).

## Kleio's link

kleio-link-host serves the link from this machine. Its [README](../kleio-link/README.md) covers the
security model, the relays, and what a relay sees.

- **Only paired keys get in.** kleio-link-host lets in the keys in `secure/link-allow.json`, which
  the device registry writes on every pairing and revoke. Pairing is open to any key, within a
  budget: 10 a minute, one at a time.
- **The link listener takes only kleio-link-host.** Each connection opens with
  `KLEIO-LINK/1 <device key> <secret>`. The secret is `secure/link-upstream.token`, compared in
  constant time. The connection is closed before anything else is read if that line is garbled,
  over 256 bytes, unfinished after 5 s, or has the wrong secret.
- **Tokens are bound to keys.** On the link, a device's token is good only from the key it paired
  with. A device paired over the link is refused on 8443, and one paired over Tailscale is refused
  on the link.
- **It keeps running while kleio-host restarts.** It reads the secret and the allow-list again
  when they change. While kleio-host is down, phones get a 502, `{"error":"kleio_down"}`.
- **`init` makes the link's key and secret.** `serve` makes any that are missing on a host set up
  before the link. kleio-link-host only reads them.
- **It reports where it is** in `link/state.json`: its relay, its direct addresses, each relay's
  health, and each device's last path. `kleio-host status`, `devices` and `pair` read it.

## Install on the mini

Install the first time by hand (below). After that, deploy from the laptop with `deploy-mini.sh`,
which keeps a way back:

```sh
# laptop, anywhere in the repo
sh packages/kleio-host/scripts/deploy-mini.sh --dry-run   # print every command; run none
sh packages/kleio-host/scripts/deploy-mini.sh             # build, back up, deploy, check health
sh packages/kleio-host/scripts/rollback-mini.sh           # back to the code that ran before
```

`MINI=<ssh host>` picks another machine (default `mac-mini-1`). `HEALTH_WAIT=<seconds>` sets how
long both scripts wait for the host to be healthy (1–600, default 60). `--no-build` deploys what
is already built. Both scripts take `--dry-run` and `--help`.

A deploy, in order:

1. **Builds** `@kleio/coder` and the workspace packages it bundles, then the sidecar bundle, the
   host and its page and PDF capture helper (`build-capture.sh`, which needs Xcode), as the steps
   below do. The bundle is made from those packages' `dist` folders, so building them first keeps
   an older build from shipping. Then it builds kleio-link-host for Apple silicon with cargo
   (`--release --target aarch64-apple-darwin`, into `CARGO_TARGET_DIR` if that's set). An Intel
   Mac needs `rustup target add aarch64-apple-darwin` first.
2. **Checks the mini, read-only:**
   - the code, the state folder, `~/.gg`, and the sidecar and serve plists are there;
   - the disk has room for a full copy of them plus 1 GB;
   - the mini has Apple silicon (`uname -m` is `arm64`), which kleio-link-host is built for.

   It prints the mini's macOS version, and warns below macOS 14, where the capture helper can't
   run (see [Page and PDF capture](#page-and-pdf-capture-kleio-capture)).

3. **Keeps the running code** in `~/kleio-host/.prev`: `dist`, `sidecar`, `bin` (once a deploy has
   brought kleio-link-host), `install-mini.sh`, and the `com.kleio.host.*` plists. It is built as
   `.prev.new` and then renamed, so a dropped connection never leaves half a `.prev`. The last
   deploy's `.prev` becomes `.prev-<UTC time>`.
4. **Snapshots the state** into `~/kleio-backups/<UTC time>/` on the mini, with a `manifest.txt`:
   - `state/`: the host's state folder (keys, device registry, rings, Blobs, groups);
   - `gg/`: `~/.gg` (sign-ins, sessions, memory, the dictation model).

   The folder is 0700 and never leaves the mini. Files are APFS clones where the disk allows
   (seconds, little space), with modes kept and file counts checked. The host keeps running: the
   registry and keys are always written whole, but a ring file may catch an append in progress.

5. **Deploys** with the `rsync` commands below, then runs `install-mini.sh`. That restarts the
   sidecar and serve jobs, and the link job only if kleio-link-host or its plist changed.
6. **Waits up to 60 s** (`HEALTH_WAIT`), trying once a second, for two things:
   - `/kleio/health` on the mini says `ok`, with the sidecar up;
   - kleio-link-host is on a relay. It only counts once the link job's own process has written
     `link/state.json`, so a file an earlier process left behind doesn't.

**The in-progress mark.** Step 3 writes `~/kleio-host/.deploy-in-progress`, and a healthy deploy
removes it. A deploy that fails after the code started changing keeps the mark and prints the
rollback command; nothing rolls back by itself. While the mark is there another deploy refuses, so
it can never save broken code as `.prev`. `--force` deploys anyway, keeping the `.prev` from before
the unfinished deploy.

**Rollback** (`rollback-mini.sh`) needs `.prev/dist/cli.js` and `.prev/sidecar/app-sidecar.mjs`.
It moves the current code and plists aside to `~/kleio-host/.rolled-back-<UTC time>/`, and puts
`.prev`'s in their place. Then it restarts the jobs in order (the sidecar, serve, then the link if
`.prev` has one), waits for health (the link's too, once it's back) and clears the mark.

- A `.prev` from before the link has no `bin/`. Then the link job is stopped, and its plist and
  `bin/` go aside with the rest.
- It restores code only. `.prev` stays, so it can run again.

**Nothing is deleted** by either script. A deploy ends by listing what is kept, with sizes (clones
share blocks, so the disk holds less than they add up to). Remove old snapshots, `.prev-*` and
`.rolled-back-*` folders by hand.

### Restore a state snapshot

By hand, on the mini, and only when the state itself is damaged. Everything since the snapshot
goes: devices paired since must pair again, and **a device revoked since works again** until you
revoke it again. Restoring `gg/` too also drops the chats and sign-ins since. A snapshot from
before Kleio's link has no link key, so `serve` makes a new one, and every phone paired over the
link must pair again.

```sh
# mini
launchctl bootout gui/$(id -u)/com.kleio.host.link
launchctl bootout gui/$(id -u)/com.kleio.host.serve
launchctl bootout gui/$(id -u)/com.kleio.host.sidecar
launchctl list | grep com.kleio.host               # wait until this prints nothing
B=~/kleio-backups/<UTC time>
S="$HOME/Library/Application Support/Kleio/host"
mv "$S" "$S.replaced-$(date -u +%Y%m%dT%H%M%SZ)"   # keep what you replace
cp -cRp "$B/state" "$S"
# ~/.gg too, only if it needs it: mv ~/.gg ~/.gg.replaced-<time> && cp -cRp "$B/gg" ~/.gg
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kleio.host.sidecar.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kleio.host.serve.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kleio.host.link.plist
curl -s http://127.0.0.1:8443/kleio/health
kleio-host status                                  # and the link
```

### By hand

```sh
# laptop
pnpm --filter '@kleio/coder...' build   # the packages the sidecar bundle is made from
node gg-app/scripts/bundle-sidecar.mjs
pnpm --filter @kleio/host build
sh packages/kleio-host/scripts/build-capture.sh   # dist/bin/kleio-capture; after the host build
cargo build --release --locked --features host --bin kleio-link-host \
  --target aarch64-apple-darwin --manifest-path packages/kleio-link/Cargo.toml
rsync -az --delete packages/kleio-host/dist/   mini:kleio-host/dist/
rsync -az          packages/kleio-host/scripts/install-mini.sh mini:kleio-host/
rsync -az --delete gg-app/src-tauri/sidecar/    mini:kleio-host/sidecar/
ssh mini mkdir -p kleio-host/bin
rsync -az packages/kleio-link/target/aarch64-apple-darwin/release/kleio-link-host \
  mini:kleio-host/bin/kleio-link-host
# mini
sh kleio-host/install-mini.sh          # idempotent; `uninstall` to remove jobs
sh kleio-host/install-mini.sh cli      # only the `kleio-host` command, no restarts
```

The installer also writes a `kleio-host` command to `~/.local/bin` (no sudo) and adds
that folder to PATH in `~/.zprofile` once, so login and SSH shells can run it. It uses
the same node and `dist/cli.js` as the launchd jobs.

The installer retires the earlier `com.kleio.*` / `com.atlas.*` / `com.hermes.*` /
`com.noledge.*` user agents (plists moved to `LaunchAgents/retired-by-kleio-host/`; the three
`com.kleio.host.*` jobs stay). It creates keys (the link's too) and the first admin device, and
checks kleio-link-host runs here (`kleio-link-host id`). Without `bin/kleio-link-host`, it stops
before touching the state or the jobs. Root-owned leftovers under `/Library/LaunchDaemons` are
unloaded if `sudo -n` allows it; otherwise they are listed with the one `sudo mv` to run (they are
disabled in launchd and cannot start, so this is cleanup, not a blocker).

- **The link job restarts only when it must:** when kleio-link-host or its plist changed, or it
  isn't running. Their hash is in `~/kleio-host/.link-job`. So phones stay connected through a
  deploy of kleio-host alone. Its log is `logs/link.err.log` in the state folder.
- **Tailscale is optional.** When it's installed (`/usr/local/bin/tailscale`, or `TAILSCALE_BIN`),
  the installer sets `KLEIO_PUBLIC_URL` and `KLEIO_PREVIEW_URL` from the Mac's tailnet name. It
  also points `tailscale serve --https=8443` and `--https=8444` at the host (`uninstall` turns both
  off; `tailscale serve status` shows them).
  - Installed but stopped or signed out, Tailscale stops the install, which says so.
  - Without Tailscale, phones pair and connect over the link alone, and there are no site
    previews.
- **`uninstall`** stops and removes all three jobs. The state stays.

## Develop against a local host

`gg-app/scripts/dev-host.mjs` runs the real host and sidecar from this checkout on the laptop, in a
throwaway sandbox, for the desktop app to talk to. It never goes near the mini.

```sh
pnpm --filter "@kleio/coder..." build && pnpm --filter @kleio/host build
pnpm --filter gg-app stage:node && pnpm --filter gg-app bundle:sidecar
node gg-app/scripts/dev-host.mjs                        # a fresh sandbox, removed at exit
node gg-app/scripts/dev-host.mjs --keep                 # keep the fresh sandbox at exit
node gg-app/scripts/dev-host.mjs --dir /tmp/kleio-dev   # reuse one: pairings and chats survive
node gg-app/scripts/dev-host.mjs --app                  # and the app as a new user (below)
```

It prints:

- the host's URL, `http://127.0.0.1:<port>`;
- an admin pairing code (single use, 5 minutes), the `curl` that redeems it, and the command for
  another;
- the line that starts the app against the host (below);
- the sandbox folder, the app's token file (`app.env`, 0600), the logs and the process ids.

Ctrl-C stops the host and sidecar (SIGTERM, then SIGKILL after 8 s; on Windows, a hard kill),
checks the real folders and removes the sandbox (kept with `--dir` or `--keep`).

**Sandboxed.** One folder holds everything the host and sidecar write: their home, the host's
state folder, the Kleio and projects folders, the settings file and the sidecar's working folder.
The shell's own `KLEIO_*`, `GG_*` and `NODE_OPTIONS` don't reach them. It refuses to run when any
of those paths is, contains or is inside the real home, `~/.gg`, `~/.kleio` or host state folder
(symlinks resolved, case ignored). At exit it compares the real `~/.kleio` and host state folder
with how they were, and fails if `remote.json` or the state folder changed. Other changes in
`~/.kleio` (the app keeps its workspace file there) are only reported.

**Loopback HTTP only.** The API and the preview origin listen on spare 127.0.0.1 ports, and the
sidecar on its own as always: no Tailscale Serve, no TLS, nothing on the LAN or tailnet.

**Start the app** with the printed line, which uses the env override in gg-app's `kleio/mod.rs`:

```sh
KLEIO_HOST_URL=http://127.0.0.1:<port> KLEIO_DEVICE_TOKEN=<token> pnpm --filter gg-app tauri dev
```

The app then takes its host from the environment, not from `~/.kleio/remote.json`, and leaves that
file alone. Don't pair from it: a debug build's pairing form takes `http://127.0.0.1:<port>`, but
this app runs with your real home, so pairing would write `~/.kleio/remote.json` and the Keychain,
replacing your pairing with the mini. To try pairing, use `--app` (below).

- **Not an admin.** Env mode is always `admin: false`, so the app hides its admin screens.
  dev-host pairs the app as an ordinary device, so Setup (which asks the host) agrees: its key
  forms show status only. Leave `KLEIO_CONTROL_CREDENTIAL` unset: the app would send it, and the
  host would then treat the app as an admin while the app still hides its admin screens. Try the
  admin routes with the admin code and `curl` instead.
- **No AI sign-in.** The sandbox starts with no provider signed in, so Setup shows that step as
  missing, and chats need one first. A sign-in from the app is the host's, so it lives in the
  sandbox and goes with it.

> **Warning:** in an app started this way, don't use **Forget host** or **Pair**. Forget host
> (`kleio_forget`) deletes the real `~/.kleio/remote.json` and the mini's Keychain items, whatever
> the environment says, and Pair replaces them.

### Open the desktop app as a new user (`--app`)

`--app` runs Kleio's first run for real: the app with no pairing, the pairing form, the restart,
and Setup as an admin device. It runs on macOS only, needs `cargo` and `pnpm` on PATH, and takes a
fresh sandbox (no `--dir`).

```sh
node gg-app/scripts/dev-host.mjs --app           # sandbox removed at exit
node gg-app/scripts/dev-host.mjs --app --keep    # sandbox kept at exit (its keychain isn't)
```

It builds the debug app (`cargo build`), uses gg-app's Vite on port 1420 or starts it, starts the
host as above, mints one admin code and opens the app. It prints the host URL and the code. In the
app: **Pair with your host**, then the URL and the code, **Pair**, **Restart now**. The relaunched
app opens on Setup with the admin key forms (Composio, Typesafe). The code lasts 5 minutes; the
printed command makes another.

**A new user, in the sandbox.** The app gets your environment without `KLEIO_*`, `GG_*` and
`NODE_OPTIONS`, and with `HOME`, `USERPROFILE` and `CFFIXED_USER_HOME` set to `<sandbox>/home`.
Its `~/.kleio`, its `~/Library` folders (logs, caches, webview storage, so Setup opens by itself)
and its keychain are all in there. dev-host finds the app again after **Restart now** by that
`HOME`, and at exit stops it, then Vite (if it started Vite), then the host.

**Its own keychain.** macOS finds a user's keychains through `HOME`, so dev-host gives the sandbox
home a throwaway keychain, `Library/Keychains/kleio-dev-host.keychain-db`, as its default and only
keychain: a random password kept in memory, unlocked, never locking itself. The app's token and
control credential go there, never to your login Keychain. After each `security` command that
changes a keychain, dev-host checks your real search list and default keychain; if either changed,
it puts them back and stops. At exit it deletes the sandbox keychain (with `--keep` too), and fails
if your search list, default keychain, login keychain, or the app's items for your host and for
127.0.0.1 changed.

Not in the sandbox: what macOS keeps per app rather than per home folder (permissions,
notification settings), the build in `gg-app/src-tauri/target`, and Vite.

> **Warning:** pair it with the printed URL only. Pair and Forget host there touch only the
> sandbox's `~/.kleio` and keychain, but pairing a real host from it would register a throwaway
> device there.

Run one `--app` at a time: runs share Vite on port 1420, and the run that started it stops it at
exit.

## Pair a device

```sh
kleio-host pair            # the code (ABC-DEF; 5 min, single use), its QR code and pairing text
kleio-host pair --admin    # also grants a control macaroon
kleio-host devices         # each device, with its link key's prefix and last path
kleio-host revoke <deviceId | link key prefix>
kleio-host status          # health, and the link: running, its relay, its key's prefix
ssh mini 'zsh -lc "kleio-host devices"'   # from the laptop
```

**The QR code** carries the pairing ticket. That's the host's name, its link key, its relays (the
one it's on first), up to two direct addresses, and the code, but never a token.

- `pair` draws it with `kleio-link-host qr`. kleio-host finds that in `bin/` beside `dist/`, or at
  `KLEIO_LINK_HOST_BIN`.
- `pair` also prints the ticket as text, for "Paste pairing text" on a Mac.
- While kleio-link-host is down or on no relay, there's no ticket, and `pair` says why.
- `POST /kleio/pair/offer` gives the same: `ticket`, or `null` with a `ticketError`.
- An admin device shows them too, in Settings → Connection → **Pair a device** and in the ⌘⇧K
  pane's Devices tab. Without a ticket it says why, and a device paired by a tailnet address draws
  a Tailscale QR code instead.

**Redeeming:** the device POSTs `{ code, redemptionNonce, label }` to `/kleio/pair/redeem`, and
receives `{ baseUrl?, host, token, label, deviceId, controlCredential?, previewOrigin? }`.
`previewOrigin` is where the host's site previews open, such as
`https://mini.tailnet.ts.net:8444`. It's absent on a host without previews.

- **Over the link,** the request goes through kleio-link-host, and the new device is bound to the
  phone's link key. There's no `baseUrl`, since the token is good only on the link. A phone that
  pairs again from the same key replaces its older pairings, which are revoked.
- **Over Tailscale,** the request goes to 8443, and `baseUrl` is `KLEIO_PUBLIC_URL`.

**Redeem answers:**

| Status | Body `error`                              | When                                                            |
| ------ | ----------------------------------------- | --------------------------------------------------------------- |
| 200    | (the payload)                             | The code was right.                                             |
| 400    | `bad_request`                             | The body isn't a code and a nonce.                              |
| 401    | `unauthorized`                            | A wrong code. The fifth wrong try locks the code.               |
| 404    | `not_found`                               | No code is waiting.                                             |
| 410    | `used`, `expired`, `replaced` or `locked` | That exact code was live and isn't any more. Given for an hour. |

A wrong code always gets the same 401, so a guess learns nothing. The 410s let a phone scanning an
old QR code say what to do.

**Admins are told.** Each new pairing pushes an alert to every admin device but the new one, such
as "It can now use Kleio on mac-mini-1. If you didn't pair it, revoke it."

Every later request carries `x-kleio-device-token` (admin devices add `x-kleio-control`).
`GET /events?session=…` frames carry `id:`; reconnect with `Last-Event-ID` and the host replays
what was missed (persisted ring, survives a host restart).

**Revoking** a device closes its open streams at once.

- kleio-link-host closes its link connection within about 2 s, with code 5 (`REVOKED`).
- `revoke` takes a device ID, or at least 8 characters of a link key, as `devices` and
  kleio-link-host's log show them.
- A device can remove itself, and only itself, with `DELETE /kleio/devices/self`.
- In the app, an admin revokes a device in **Devices**, with **Revoke this device**. A device
  paired in the last week is marked **New**, so a pairing nobody meant stands out.

`GET /kleio/link` gives any paired device what it needs to find the host again:

- its key;
- its relay list, with `listVersion`;
- the relay it was last on, and its direct addresses;
- whether a relay is slowing it down;
- whether kleio-link-host is running.

### From gg-app (the laptop)

1. On the mini: `kleio-host pair --admin` → `ABC-DEF`.
2. In gg-app: **⌘⇧K** → host URL (`https://mac-mini-1.<tailnet>.ts.net:8443`) + the
   code → **Pair** → **Restart now**.
3. The title strip shows **on mac-mini-1**; sessions now run there. The picker lists
   the mini's projects; "New project" points you at the mini.

Debug builds also take a host on this Mac, exactly `http://127.0.0.1:<port>` (dev-host `--app`);
release builds take `https://` only.

Kleio on the iPhone and the Mac pairs over the link instead, with no URL and no Tailscale. The
iPhone scans the QR code `kleio-host pair` shows, and the Mac takes its pairing text pasted in
("Paste pairing text"). An iPhone debug build takes the pasted text too, as the simulator has no
camera.

The token and control credential go to the Keychain (`com.kleio.gg-app`): the login Keychain
on the Mac, and on the iPhone the app's own, where they can be read once the phone has been
unlocked after starting and stay on that phone. The non-secret record goes to
`~/.kleio/remote.json`. Admin actions in the pane's
**Devices** tab (list, revoke, mint a code) ask for Touch ID once per 15 minutes and
refuse without it. **Forget host** + restart returns to local mode. Env override for
development: `KLEIO_HOST_URL` + `KLEIO_DEVICE_TOKEN` (+ `KLEIO_CONTROL_CREDENTIAL`).

### Routines (`/schedule`) run here

A `/schedule` typed in gg-app is stored by the host's sidecar (`~/.gg/routines.json` on
the mini) and fires there on its own ticker, in a session of its own, with no window open
anywhere. Rules: first run one interval out; missed occurrences (sleep, restart) are skipped,
never replayed; a fire during a run queues; no duplicate in the queue; cap 20. The host
tracks each routine's session so its transcript is in the replay ring for whichever device
attaches later.

### Home thread (`/kleio/home`)

One pinned assistant conversation that every paired device opens: a sidecar chat session
(`mode: "chat"`, agent `general`, so memory, Jiwa and handoff to Therapist/Research all
apply). Any paired device may call it; it is not admin-only.

```
GET /kleio/home  → 200 { sessionId, sessionPath: string | null, created, agent: "general" }
                 → 502 { error: "sidecar unavailable" | "sidecar error", detail? }
```

- **Idempotent:** overlapping calls share one answer, so two devices can never make two
  homes.
- **State:** kept in `home.json` next to `sessions.json`.
- **Sidecar restart:** the stored id dies with the process. The next call creates a session
  that resumes the stored transcript under a new id. If that transcript is gone or refused,
  it starts a fresh home rather than retrying.
- **Transcript path:** learnt at the home session's run ends and re-read after each one,
  since compaction moves it.
- **Replay:** the home session is tracked at start, so its events are in the replay ring with
  no device attached.
- **`/kleio/health`:** does not list the home id.

**Clients:** use the returned `sessionId` on the ordinary per-session routes (`x-gg-session`
or `?session=`), e.g. `/prompt`, `/events`, `/memories`. On a 404 from any of them, call
`/kleio/home` again.

**New conversation:** `POST /kleio/home/new` has the same shape as the GET, with
`created: true`.

- Starts a brand-new home session (no transcript resumed) and pins it.
- Stops recording the old one.
- Every device follows on its next `GET /kleio/home`.
- Old transcripts stay on disk under `~/.gg/chat-sessions/general/`, and durable memory and Jiwa
  carry over.
- Two taps at once make one conversation.

Session cwd: `KLEIO_HOME_CWD` (default `~/Kleio`, created if missing).

**Coding projects:** Kleio keeps its own projects folder and app settings, so it never shares
them with the upstream desktop app on the same Mac (it keeps `~/gg-projects` and `~/.gg/gg-app.json`).

- Projects folder: `KLEIO_PROJECTS_DIR` (default `~/kleio-projects`, created if missing).
- App settings: `KLEIO_SETTINGS_FILE` (default `~/.gg/kleio-app.json`).
- Kleio's project list shows only projects inside its projects folder (and any extra folders
  you add), not every project other coding tools on the Mac mini have opened.
- Both must be absolute paths. The host passes them to the sidecar as `GG_APP_PROJECTS_DIR`
  and `GG_APP_SETTINGS_FILE`.
- Provider sign-ins (`~/.gg/auth.json`) and local model endpoints (Ollama, Tinfoil) stay
  shared: they belong to the machine.

### Started chats (`POST /kleio/chats`)

The voice's `start_chat`. Any paired device. Body `{ prompt, agent?: "general" | "research" }`
(prompt trimmed, 1–4000 characters; agent defaults to `general`).

- Creates a chat session in the first projects folder (so it shows in Chats), prompts it, and
  answers `200 { sessionId }`. Like every chat there, it saves what it makes under `Kleio Chat/`, so
  its files never look like a new project. `400 bad_request`, `404 not_found` (no projects folders),
  `429 too_many` (5 still running), `502` when the sidecar fails.
- Its run end, with nobody watching, nudges "Research ready" / "Chat ready" with its title.
- A device opening it from Chats (`POST /session { sessionPath }`) is handed the same live
  session. `POST /sessions/delete { path }` on it disposes it first, or is a 409 while it runs.
- Unopened, it is disposed 12 h after it finished (at most 8 idle kept). In memory only: after a
  host restart these are ordinary sessions.

### Projects (`/kleio/projects`)

The voice's `list_projects`, `read_project` and `create_project`, and coding work it sends with
`send_plan`. Any paired device, as a Code session through the proxy is. A project is a plain folder
directly inside one of Kleio's projects folders: not hidden, not a symlink, not a tooling or build
folder, not `Kleio Chat` (where chats keep their files), not Kleio's own folder (`KLEIO_HOME_CWD`), and never the home folder, a filesystem root or a
Mac consent-gated folder (Desktop, Documents, Downloads) used as a projects folder. A device only
ever sends a project's name; the host finds the folder again among the ones it lists.

- `GET /kleio/projects` answers `200 { projects: [{ name, lastActivity, sessions, now? }] }`, most
  recently worked on first (at most 40). `sessions` counts its saved coding sessions; `now`
  (`{ state: "working" | "needs_you", doing }`) is a Code session working, or asking a question, in
  it right now.
- `GET /kleio/projects?name=` answers the same fields plus `recent` (its 5 newest coding sessions'
  titles), `latest` (the newest one's latest prompts and replies, as `GET /kleio/sessions/:id`) and
  `docs` (its 10 newest documents, as the files list).
- `POST /kleio/projects { name }` makes an empty project in the first projects folder: lowercase
  letters, digits and single dashes, at most 64 (the app's own rule). `409 exists` when any projects
  folder has that name (case-insensitively).
- `POST /kleio/projects/code { name, prompt }` (prompt 1–4000 characters) starts a Code session in
  that project's folder, prompts it, and answers `200 { project, sessionId }`. It is a started chat
  in all but mode: the same cap (5 started chats and coding sessions running), nudge (named for the
  project), handover when a device opens it, and disposal.
- `400 bad_request`, `404 not_found` (no such project, or no projects folders), `405`,
  `503 projects_unavailable` when the sidecar can't answer. Logs carry the device, what was asked,
  the status and the time, never names or prompts.

A project's documents are also files for the voice (`source=project`, below): words to read (text,
PDF, documents, spreadsheets, slides, web pages) outside build output, plus its coding agents' plans
in `.gg/plans/` (read only from inside that folder, and never through a symlink). Its code, data and
other hidden files are never listed or read.

### A specialist's latest messages (`GET /kleio/blobs/:id/messages`)

The voice's `read_specialist`. Any paired device; read-only. Answers
`200 { messages: [{ from, text }], lastActivity? }` from the Blob's newest saved conversation (the
sidecar's listing, found by its folder), as `GET /kleio/sessions/:id`, without opening a session;
`{ messages: [] }` before its first. `404` for an unknown Blob, `503 sessions_unavailable`.

### Saved chats and coding sessions (`GET /kleio/sessions`)

The voice's `list_chats`, `read_chat`, `list_code_sessions` and `read_code_session`. Any paired
device; read-only. `?kind=chat|code` is required.

- `GET /kleio/sessions?kind=…` answers `200 { sessions: [{ id, title, agent?, project?, lastActivity }] }`,
  newest first (at most 30). Chats come from every chat agent (`agent` is set for all but General);
  coding sessions carry their project folder's name.
- `GET /kleio/sessions/:id?kind=…` answers the same fields plus
  `messages: [{ from: "user" | "assistant", text }]`: the active branch's latest prompts and replies
  (no tool calls, thinking or injected notes). The sidecar looks the id up in its own listing
  (`GET /stored-sessions`); it never takes a path.
- Kleio's own threads (home, Blobs, groups, under `KLEIO_HOME_CWD`) are left out: they have their
  own routes. `400 bad_request`, `404 not_found`, `503 sessions_unavailable` when the sidecar
  can't answer.

### Files agents made (`/kleio/voice/files`)

The voice's `list_files` and `read_file`. Any paired device; read-only. `source` is `kleio` (the
home thread's folder, minus `blobs/` and `groups/`), `specialist` (`id` = Blob id), `group` (`id` =
group id: every current member's folder), `chat` / `code` (`id` = saved session id), or `project`
(`id` = project name: its documents only, see Projects).

- `GET /kleio/voice/files?source=&id=` answers `200 { files: [{ path, name, kind, size, modified,
readable, member?, by? }] }`, newest first (at most 40). Folders are walked by `lstat` (no
  symlinks), skipping hidden names and tooling folders, 5 levels and 3,000 entries at most. The one
  hidden folder listed is the owner's own `.gg/generated`: the pictures `generate_image` made
  (PNG, JPEG, GIF, WebP), one level deep, when neither `.gg` nor the folder is a symlink. A chat or
  coding session lists only files it wrote (`write`, `generate_image`, `screenshot`) or linked in a
  reply (the sidecar's `GET /stored-sessions/:id?files=1`) that are still regular files inside its
  folder, which must be in Kleio's projects folders (†); of its hidden files, only those pictures.
- `POST /kleio/voice/files/read { source, id?, member?, path, part? }` (path in the body, 4 KB at
  most) answers `200 { name, kind, part, parts, text, pages? }`, 12,000 characters a part. The path
  goes through the file route's checks, must be one the list could show, and for a chat or coding
  session must be one of its own files. The sidecar's `POST /file-text` extracts the text (plain
  text and code, HTML, PDF (200 pages), docx, pptx, xlsx; nothing else), capped and redacted like
  agent tool output. 20 MB at most.
- `400 bad_request`, `404 not_found`, `413 too_large`, `415 unsupported`,
  `416 { error: "no_such_part", parts }`, `422 unreadable`, `503 files_unavailable`. Logs carry the
  device, source, status and time, never names, paths or text.

### Shows (`/kleio/voice/show`)

The voice's `show`: a file her agents made, or a web page or PDF, on the user's screen beside her
while the call goes on (`show.ts`). Any paired device; a show is only ever its own device's, and
lasts 15 minutes.

- `POST /kleio/voice/show { source, id?, member?, path }` (a file, named as `read_file` names one)
  or `{ url, view? }` (`view`: `desktop`, the default, or `phone`); 4 KB at most. Answers
  `200 { show: { id, kind, name, state, … } }`. `kind` is `text` (`format`: `markdown` or `plain`;
  `cut` past 1 MB), `image`, `pdf` (`pages`, `totalPages`, `title?`) or `web` (`host`; when ready,
  `width`, `height`, `cut`, `signIn`, `title?`). A file is ready at once: a document's text is
  extracted, a picture's type read and a PDF counted before the answer. A web address answers
  `state: "capturing"` and is captured in the background (capture.ts); a PDF link turns into `pdf`.
- `GET /kleio/voice/show/<id>` answers `{ show }` again: `state` is `capturing`, `ready` or
  `failed` (`reason`, `detail` in plain words, and the site's `status` for `http_status`).
- `GET /kleio/voice/show/<id>/text | image | page-<n>` draws it: text as
  `text/plain; charset=utf-8` (Markdown and a document's or web page's extracted text alike, never
  HTML), a picture as the type its bytes say it is (PNG, JPEG, GIF or WebP), a PDF's page as a PNG
  (n ≤ 500, and at most its `pages`). Every part has `x-content-type-options: nosniff`,
  `content-security-policy: sandbox; default-src 'none'` and `cache-control: private, no-store`.
- **What can be shown.** A file is named by its owner and a relative path, never an absolute
  path, and checked again on every request, each segment by `lstat` so that a symlink anywhere below
  the owner's folder is not followed:

  | Owner's folder                                                                 | Shown                                                                                  |
  | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
  | Kleio's (`kleio`, not `blobs/` or `groups/`), a specialist's, a group member's | text, Markdown and data files; docx, xlsx, pptx and HTML as their text; pictures; PDFs |
  | A project's (`project`)                                                        | its documents and pictures, outside build output; never code, data or secrets          |
  | A chat's or coding session's (`chat`, `code`)                                  | only files it made                                                                     |
  | `.gg/plans/<file>` in any of them but a session's                              | documents (a coding session's plans show from its project)                             |
  | `.gg/generated/<file>` in any of them                                          | pictures (for a session, those it made)                                                |

  Those two are the only hidden names allowed, one level deep. Never: `..`, `~`, an absolute path,
  a backslash or control character, a percent escape that spells any of those, tooling folders
  (`node_modules` …), SVG, HEIC, code, audio or video (`415 unsupported`). The first 1 MB of text
  is drawn; pictures up to 20 MB, PDFs up to 50 MB and documents to extract up to 20 MB
  (`413 too_large`). A file changed since it was shown answers `409 changed`.

- **The app's file viewer** draws a Chat or Code session's files as shows too, named by the
  session's folder: `{ source: "workspace", cwd, path }`, with no `id`, `member` or `url` beside it
  (`400`). Her voice can't name this source: `list_files`, `read_file` and her `show` take only the
  ones above. `cwd` must be in Kleio's projects folders with no hidden folder on the way, as for the
  workspace file route, and is checked again on every part (`404`). In it, Markdown, text, CSV,
  PDFs and pictures show anywhere but tooling folders (build output such as `out/` is fine); in
  `.gg/generated/<file>` and `.gg/screenshots/<file>`, one level deep, only pictures. A session's
  `.gg/plans` never shows here, and `.gg/screenshots` only here. Any other kind is
  `415 unsupported`, and the app opens it in its own app instead. Logged as `show workspace`, never
  with the folder or the path.

- **Hosts that can't draw.** Web pages and PDFs need the capturer: without it, `501 unavailable`
  ("Kleio can't show web pages or PDFs on this host."), before anything is fetched; text, Markdown
  and pictures still show. A refused address answers `422 refused` (with `refusal`) even then.
- A new show from a device stops that device's capture still running. `400 bad_request`,
  `404 not_found` (another device's show and an expired one too), `405`,
  `409 not_ready | failed | changed`, `410 expired`, `413`, `415`, `416 { error: "no_page", pages }`,
  `422 refused | unreadable | locked`, `429 busy`, `501 unavailable`, `502` for a capture that
  broke, `503 files_unavailable`. Logs carry the device, the source or a link's host, the status
  and the time; never names, paths or addresses.

### Blobs (`/kleio/blobs`)

Named helpers with a job, each with its own pinned conversation and schedules, stored in
`blobs.json` (runs in `runs-<blobId>.jsonl`, last 100).

- **Session:** a sidecar chat session with a **persona** (name + job) in place of General's
  role prompt. It shares durable memory and Jiwa with Kleio and has no handoff.
- **Cwd and model:** cwd is `<KLEIO_HOME_CWD>/blobs/<id>`, and the model is pinned per Blob
  (default `KLEIO_BLOB_DEFAULT_MODEL`, else Tinfoil Kimi K3).
- **Access:** any paired device; not admin-only.
- **Caps:** 12 Blobs, 10 schedules per Blob.

| Route                                                               |                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /kleio/blobs`, `PATCH/DELETE /kleio/blobs/:id`            | CRUD. A change to name, job or model retires the live session; the next open resumes the same transcript with the new persona.            |
| `GET /kleio/blobs/:id/session`, `POST …/new`                        | Same semantics as `/kleio/home` and `/kleio/home/new`. A model the sidecar refuses is a 502 `model unavailable` (never a cloud fallback). |
| `POST/PATCH/DELETE …/schedules[/:sid]`, `POST …/schedules/:sid/run` | Schedules: `interval` (≥ 15 min), `daily`/`weekly` at HH:MM in an IANA zone (DST-correct), `once`.                                        |
| `GET …/runs`                                                        | Newest first, max 50.                                                                                                                     |
| `GET /kleio/models`                                                 | `{models:[{id,label,private}], defaultBlobModel}`, private first.                                                                         |

**Scheduler** (5 s tick):

- Missed occurrences are skipped, never replayed.
- At most one fire per tick.
- A busy conversation logs the occurrence as `skipped`.
- A fire prompts the Blob's own conversation with `⏰ Scheduled task "<label>": …`.
- At its run end the run is closed with a 280-char summary.
- A `notify` schedule sends an APNs alert titled `<emoji> <name>` **even while a device is
  attached**.

**Auto-schedules:** `POST /kleio/blobs` (and a `PATCH` that changes `job`) reads timing out of
the job with the sidecar's one-shot `POST /complete` on the Blob's model (25 s, never a cloud
fallback) and adds up to 5 schedules with `source:"auto"`.

- Body extras: `timezone` (IANA, default `Europe/London`) and `autoSchedule` (default `true`).
- The answer gains `autoSchedules: {status: ok|none|failed, count, error?}` whenever it ran; the
  Blob is saved either way.
- A re-read replaces only the `auto` schedules (a failed one leaves them); `manual` ones
  (`POST …/schedules`, and anything saved before) are never touched.
- `POST /kleio/blobs/suggest-schedules {job, model?, timezone?}` → `{schedules}`: a preview
  with no writes (502 `{error}` when the read fails).

### Group chats (`/kleio/groups`)

Several Blobs in one conversation with you, stored in `groups.json`. Messages are kept in
`group-<id>.jsonl` (the last 500). Limits: 20 groups, 1–8 members each.

- **Who replies:** a message's `@mentions` reply; if there are none, every member replies in
  order.
- **Handing on:** a reply that `@mentions` another member passes the turn to them. The group
  pauses after 10 turns in a row with no tool call, PASSes included (Blobs talking in circles),
  and after 200 turns per message of yours, a cost backstop only.
- **Staying quiet:** a Blob with nothing to add answers `PASS`, and nothing is posted.
- **Sessions:** each (group, Blob) pair has its own pinned conversation (cwd
  `<KLEIO_HOME_CWD>/groups/<gid>/<bid>`). Its persona is the Blob's job plus a short group
  addendum. Each turn is prompted with the messages that Blob hasn't seen yet.
- **Clients:** poll `GET …/messages?after=<seq>` about every 1.5 s while the chat is on screen.
- **Notifications:** one APNs push per exchange (`kleio.groupId`), and only when no device polled
  in the last 20 s.
- **Blob changes:** deleting a Blob removes it from its groups. Renaming it, or changing its job
  or model, retires its group conversations, so they resume with the new persona.

### Apps (`/kleio/connections`, Composio)

Every Kleio conversation (home, Blobs, group members) gets Composio's Tool Router tools. They
search apps, run their actions, and offer a connect link when an app isn't linked yet.

- **Identity:** one Composio `userId` per install (`kleio_<hex>`, in `composio.json`) and one
  Tool Router session.
- **Tools:** the session's MCP URL goes into this machine's global `~/.gg/mcp.json` as
  `mcpServers.composio`. The write merges and preserves every other server, and the file is
  mode 0600. When that entry changes, idle conversations are retired, so their next turn loads
  the tools.

**Routes** (any paired device):

- `GET /kleio/connections` returns `{configured, connections:[{id, toolkit, name, logo, status,
createdAt}]}`.
- `GET /kleio/connections/toolkits?search=&cursor=` returns `{toolkits:[…], nextCursor}`.
- `POST /kleio/connections {toolkit}` returns `{redirectUrl, connectionId}`. Open it in a web sheet.
- `DELETE /kleio/connections/:id`.
- `GET /kleio/connections/callback?status=` is **unauthenticated**. It serves a fixed page that
  redirects to `kleio://connections?status=success|failed`. A sign-in started over the link, or on
  a host without `KLEIO_PUBLIC_URL`, sends Composio no callback, so it ends on Composio's own page
  instead. The device may have no way to the public URL, such as an iPhone with Tailscale off. The
  app is connected either way, and its Apps page refreshes when you come back to it.
- In-chat sign-in links, which Kleio's replies offer, use the Composio session's callback. That's
  the host's public URL when it has one, whichever way the device connects.

**Errors:** with no key, the list says `configured:false` and the other routes answer 503. A
Composio error is a 502 `{error:"composio", status, detail}`.

**Key:** set it from the app (Settings → Setup, on an admin device), or put it in
`<state dir>/composio.key` (mode 0600; `~/Library/Application Support/Kleio/host/composio.key`
on the mini). `KLEIO_COMPOSIO_API_KEY` overrides the file. No restart is needed: the key is read
on every use, and a changed or removed key drops the old Tool Router session and the
`mcpServers.composio` entry in `~/.gg/mcp.json` (other servers are kept). The key never appears in
a response or log.

**Privacy:** Composio sees tool arguments and results and stores the app logins. It is less
private than Tinfoil.

### Setup keys (`/kleio/setup`)

Third-party keys an admin device can set from Settings → Setup. An env key always wins over the
key file; no restart is needed for any of them.

- **Composio** (Apps): see above.
- **Typesafe** (Jev, the group chats' router): `TYPESAFE_API_KEY` or `<state dir>/typesafe.key`.
  Without it, groups route by relevance.
- **OpenAI** (voice): `POST/DELETE /kleio/voice/key`; shown here for completeness.

Routes (a paired device's token on all):

- `GET /kleio/setup` (any device) → `{admin, keys:{openai, composio, typesafe}}`, each
  `"missing" | "saved" | "env"`. Never a key or part of one.
- `POST /kleio/setup/keys/composio|typesafe` `{key}` (admin): the key is trimmed and checked with
  the provider (15 s) before it is written (0600, atomic). Answers the setup body, or 403
  `forbidden`, 404 `not_found` (other names; Composio without a home thread), 413 `too_large`
  (body over 4 KiB), 400 `bad_request`, 409 `set_by_env`, 422 `bad_key` (empty, over 512
  characters, whitespace, or the provider said 401/403), 502 `{error:"rejected", detail}`, 504
  `{error:"unreachable", detail}`. `detail` is redacted of the key.
- `DELETE /kleio/setup/keys/composio|typesafe` (admin): removes the key file; same 403/404/409.

### Dictation (`/kleio/setup/dictation`)

The mic in every chat box (iPhone and Mac apps) records on the device and sends the clip here;
Whisper turns it into text in the sidecar, so recordings never leave the user's devices and host.
There is no key. The engine (transformers.js and onnxruntime-node) ships with the sidecar; the
speech model doesn't:

- **What:** `onnx-community/whisper-base.en` at a pinned commit, 7 files, 139 MB. Each file is
  checked against its size and SHA-256 in `@kleio/core` (`dictation-model.ts`) before it is put in
  place, and a download that stops picks up where it left off.
- **Where:** `~/.gg/models/onnx-community/whisper-base.en/` in the home of the user the host runs
  as (the sidecar's `~/.gg`, not the host's state folder), with a `.kleio-verified.json` marker.
  Once it is there, starting dictation needs no network.
- **From:** `huggingface.co`, which redirects the model files to its `*.hf.co` CDN (for example
  `us.aws.cdn.hf.co`): outbound HTTPS to both.
- **When:** from Settings → Setup on any device, or the first recording if nobody did that.

Routes (a paired device's token; any device, since dictating already starts the download):

- `GET /kleio/setup/dictation` → `200 {dictation}`, where `dictation` is `{state, bytes}` plus:
  `absent`, `downloading {loaded}`, `loading`, `ready`, `failed {reason}` (`offline`, `server`,
  `missing`, `storage`, `integrity`, `load`) or `unsupported {os, arch}`. `bytes` is the model's
  size. Reason codes only: the details are in the sidecar's log. `503 {error:"engine_unavailable"}`
  when the sidecar doesn't answer in 3 s or its answer doesn't check out (only known fields are
  passed on).
- `POST /kleio/setup/dictation` (body up to 1 KiB, ignored) starts the download and load, or
  joins the one under way, and answers like `GET`. It logs `[setup] <device> started the
dictation download` when the state changed. `413 too_large`; other methods `405` with
  `Allow: GET, POST`.
- The sidecar's own routes (daemon-level, the host's token): `GET /dictation`,
  `POST /dictation/prepare`. Its `POST /transcribe` answers `503` with plain words for the
  reason (`502` when Hugging Face erred) when the model can't be got ready.

Where dictation runs:

| Host                        | Dictation                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac, Apple silicon          | Works (`install-mini.sh`)                                                                                                                                 |
| Mac, Intel                  | Can't: onnxruntime-node 1.24.3 (the version transformers 4.2.0 pins) has no build for macOS on Intel; Setup says so                                       |
| Linux (glibc), x64 or arm64 | Should work: the engine ships. Untested                                                                                                                   |
| Windows, x64 or arm64       | Should work: the engine ships. Untested; the model goes under the service account's `%USERPROFILE%\.gg\models`, and onnxruntime may need the VC++ runtime |

Untested anywhere: musl (Alpine), small-RAM machines, and hosts behind a proxy (Node's `fetch`
ignores `HTTPS_PROXY`).

Memory, measured on an Apple silicon Mac by `gg-app/scripts/e2e-dictation-setup.mjs` (two
runs): the sidecar went from 170 MB to 640–690 MB once Whisper was loaded, and to about 1.3 GB
after a chat session opened and the first clip was transcribed. Plan for about 1.5 GB free for
the sidecar on a host that dictates.

### Host info (`/kleio/host`)

What the apps need to know about the host itself. `GET /kleio/host` takes a paired device's
token (any device; `401` without one) and answers:

```json
{ "os": "darwin", "version": "2.1.3", "alwaysOn": { "state": "yes", "reasons": [] } }
```

- `os`: the host's `process.platform` (`darwin`, `win32`, `linux`, …).
- `version`: Kleio's release version, from `gg-app/package.json`, built into `dist`. The build
  fails unless it is `x.y.z`.
- `alwaysOn.state`: `yes` (set never to sleep on AC power), `may_sleep` (set to sleep, or not to
  come back by itself), `laptop` (it has a battery, so it sleeps when the lid closes) or
  `unknown`.
- `alwaysOn.reasons`: codes only, from `sleeps_on_ac`, `no_autorestart`, `no_wake_for_network`,
  `sleep_not_masked`, `check_failed` and `unsupported_os`. `may_sleep` has at least one;
  `unknown` has `check_failed` or `unsupported_os`; `yes` and `laptop` have none.

Other methods get `405` with `Allow: GET`. `/kleio/health` carries none of this.

The check only reads (`src/always-on.ts`); it never changes a setting. It runs each OS's own
power tool by absolute path, with an argument array, no shell, a 5 s timeout and 256 KiB of
output at most:

- **macOS:** `/usr/bin/pmset -g batt`. An `-InternalBattery-N` line is a laptop (a UPS's line
  isn't). Otherwise `pmset -g custom`, its `AC Power:` section only: `sleep` other than 0 is
  `sleeps_on_ac`, `autorestart 0` is `no_autorestart` and `womp 0` is `no_wake_for_network`. A
  Mac without `autorestart` or `womp` doesn't have that setting, so it isn't flagged for it.
  `autorestartatconnect` isn't read.
- **Windows:** from `%SystemRoot%\System32` (`C:\Windows` unless `SystemRoot` is a plain drive
  path), `reg.exe query HKLM\SYSTEM\CurrentControlSet\Enum\ACPI\PNP0C0A`: found (exit 0) is an
  ACPI battery, so a laptop. Otherwise
  `powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE`: an AC "sleep after" other than 0
  is `sleeps_on_ac`. Windows translates powercfg's labels; without the English one, the AC value
  is taken by its place among the five numbers.
- **Linux:** a power supply in `/sys/class/power_supply` of type `Battery` whose `scope` isn't
  `Device` (a mouse's or a UPS's) is a laptop; this is read from files. Then
  `systemctl get-default` (`/usr/bin/systemctl`, else `/bin/systemctl`): anything but
  `graphical.target` is a server with no desktop to suspend it, so `yes`. Otherwise
  `systemctl is-enabled sleep.target`: `masked` is `yes`, any other state `sleep_not_masked`.
- **Any other OS:** nothing runs: `unknown` with `unsupported_os`.

A program that won't start, times out, fails or prints something unexpected gives `unknown`
with `check_failed`. An answer is kept for 60 s, and calls that come while a check runs share
it, so a device can't make the host start programs in a loop. A fresh check logs each program's
path, arguments, exit code and output (JSON-escaped, the first 2,048 characters of each stream),
then `[host] alwaysOn <state> [<reasons>]`. That goes to the host log only, never to a device.

The macOS parsing is tested against `pmset` output captured from a MacBook and the mini, and the
live check has run on the MacBook (`laptop`). The Windows and Linux checks are built from those
programs' documented output and haven't yet run on a real Windows PC or Linux desktop.

### Brain (memories and Jiwa)

What Kleio remembers about the user (memories) and how they like her to work (Jiwa): two stores in
the sidecar's `~/.gg` (`chat-memories.json` and `chat-jiwa.json`, each with a `.bak`), shared by
every device. Kleio writes them with her `remember` and `set_jiwa` tools. The Brain window (Kleio
Chat's header, and Settings → Setup → Brain) lists, adds, edits and deletes entries. Setup's
"Introduce yourself" only starts a chat in which Kleio asks a few questions and saves the answers
with those tools, so it has no route of its own.

The routes are the sidecar's, reached through the host with a paired device's token (any device,
as chatting already is) and an `x-gg-session` header naming one of the sidecar's chat sessions
(404 without one):

- `GET /memories` and `GET /jiwa` → `{memories | jiwa, softLimit, hardLimit}`.
- `DELETE /memories/:id` and `DELETE /jiwa/:id` → the same snapshot.
- `POST /memories` and `POST /jiwa` add; `PATCH /memories/:id` and `PATCH /jiwa/:id` edit. The
  body is JSON `{text, category, importance}` and nothing else: `text` is trimmed, 1–600
  characters; `category` is one of the store's (memories: `identity`, `preference`, `project`,
  `relationship`, `health`, `other`; Jiwa: `identity`, `voice`, `interaction`, `boundaries`,
  `workflow`, `other`); `importance` is a whole number from 1 to 5. They answer:
  - `200` with the snapshot and the saved entry (`memory` or `entry`);
  - `400 {error}`: `Invalid Brain entry: <field>: <issue>`, or `That isn't a valid memory id.`
    (or `Jiwa instruction id`) for an id that is empty, over 200 characters or badly encoded;
  - `404 {error}`: `That memory isn't in Brain any more.` (or `That Jiwa instruction…`);
  - `409 {error, duplicateOf}` when Brain already has one like it (the tools' duplicate check),
    or `409 {error}` `Brain is full. Delete one first, or give this one a higher importance.`;
  - `413 {error:"request body too large"}` for a body over 16 KiB;
  - `500 {error}`: `Couldn't save to Brain: <reason>`. Nothing is saved.

Every change goes to every window as a `memory_change` or `jiwa_change` event.

The limits are the tools': from 60 entries in a store, Kleio is told to consolidate, and an add
past 90 removes the least important entries that aren't Identity (the least recently updated
first among equals). An add is refused (the 409 above) when the new entry would be the one
removed, or every entry is Identity. The window says "Full" at 90.

An older host's sidecar answers add and edit with its catch-all `404 {error:"not found"}`, and
the window tells the user to update Kleio on the host. Viewing and deleting work on any host.

### Files and site previews

Paired devices open what agents write on the mini: PDFs, spreadsheets, images, reports and
small web sites. Any paired device may call these; they are not admin-only.

| Route                                                  | Files under                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `GET /kleio/blobs/:id/files/<path>`                    | `<KLEIO_HOME_CWD>/blobs/<id>`                                                  |
| `GET /kleio/groups/:gid/members/:bid/files/<path>`     | `<KLEIO_HOME_CWD>/groups/<gid>/<bid>`                                          |
| `GET /kleio/workspace/files/<path>?cwd=<absolute dir>` | A Chat or Code session's folder, which must be in Kleio's projects folders (†) |

† The projects folder plus any extra project folders in the app settings, re-read on every
request. Any other `cwd` is a 404 `no such workspace`.

- **Paths:** relative, with no `.`/`..`, hidden names or links out of the folder. Max 50 MB.
  One exception, in a Chat or Code session's folder only: the pictures its tools made,
  `.gg/generated/<picture>` and `.gg/screenshots/<picture>` (PNG, JPEG, GIF or WebP), with those
  two folders spelled out (never escaped), one level deep and no link anywhere on the way.
- **Responses:** always a download (`content-disposition: attachment`, `nosniff`). HTML, SVG
  and scripts come back as `application/octet-stream`, so nothing an agent writes runs on the
  API origin.
- **A copy the app has:** each file comes with an `etag` (its size and modified time). A request
  with `If-None-Match` naming it gets 304 and no body, so the app's cached copy is used rather
  than the whole file sent again. The `[files]` line says `304 0B`. Any change to the file makes
  a new tag. Hosts before Phase 2 always send 200: the app then stops reading once it sees its
  copy's own tag.

**Site previews.** `POST /kleio/previews {owner, path}` returns `{url, expiresAt}`, a link on
the preview port. `owner` is `{kind:"blob", blobId}`, `{kind:"group", groupId, blobId}` or
`{kind:"workspace", cwd}`, and `path` must end in `.html` or `.htm`.

- **Scope:** the link serves the page's folder (so `style.css` and `data.json` next to it load).
  A page sitting directly in a projects folder gets a link to that one file only.
- **Lifetime:** 1 hour, at most 50 live links per device, gone on host restart or when the
  device is revoked.
- **Isolation:** every preview response is sandboxed (`Content-Security-Policy: sandbox …`, so
  the page has no cookies, storage or same-origin access), `no-referrer` and `no-store`. The
  API sends no CORS headers, so a preview page can't call it.
- **Links in pages:** use relative paths (`style.css`, not `/style.css`).
- **Errors:** 400 `not_a_site` (not HTML), 400 `bad_request`, plus the file errors above; 404
  when the host runs without a preview port. A host with neither `KLEIO_PUBLIC_URL` nor
  `KLEIO_PREVIEW_URL` has none: previews need Tailscale for now.
- **Where the app opens them:** only on the preview origin the pairing gave it (`previewOrigin`),
  or, for a Tailscale pairing from before pairings gave one, on the host's own name. Anything else
  the host sends is refused, not opened.
- **Over the link,** previews still open in the browser over Tailscale. Before asking the host for
  a link, the app checks the device reaches the preview origin. If it doesn't, it says "Site
  previews open over Tailscale for now: turn Tailscale on, then open again." A link pairing with no
  preview origin says "Site previews need Tailscale for now."
- **Logs:** never include the link's token.

### Page and PDF capture (`kleio-capture`)

When Kleio shows a web page or a PDF in a voice call, the mini draws it and the device gets a
picture. `dist/bin/kleio-capture` (`native/capture/main.swift`, built by `build-capture.sh`) does
the drawing with the system's WebKit and PDFKit; nothing is downloaded. It needs macOS 14 or later
and runs as a child of `com.kleio.host.serve`, in the logged-in session WebKit draws in.

- **Pages** load at 1024 CSS px wide (390 for a phone) and are drawn at 2×, a screen at a time
  down the page, into one picture: a full-screen banner stays one screen tall, and a pinned header
  or cookie banner shows once, on the first screen. They stop at 4,000 CSS px with a note that the
  page goes on. 15 s to load, 20 s in all.
- **What a page can reach:** only public addresses. The host's own fetches (`guarded-fetch.ts`,
  which tells a PDF from a page) and every connection the page makes (through a SOCKS5 proxy on
  127.0.0.1 made for that one capture, `capture-proxy.ts`) go through `net-guard.ts`: private,
  loopback, link-local, Tailscale (100.64.0.0/10, `fd7a:115c:a1e0::/48`) and local names are
  refused, a name is resolved once and the connection goes to the address that was checked, and
  every redirect is judged again. Content rules in the helper block private hosts too, the data
  store keeps nothing, and the page can't open windows, download, pick files or use WebRTC.
- **Signed-in pages** show what a visitor without your accounts sees; the helper flags sign-in and
  paywall pages.
- **Other hosts:** capture needs macOS 14 or later and the helper. On any other host, when
  `dist/bin/kleio-capture` is missing, or when the cache folder can't be made, the host logs why
  (and still starts), and a voice show of a web page or PDF answers that Kleio can't show them on
  this host, without fetching anything. Text, markdown and
  pictures still show. (`capture.ts` keeps the helper behind one `CaptureBackend` interface, so
  another platform's backend can be added.)

Run it by hand with the mode as its argument and a JSON job on stdin, e.g.
`echo '{"file":"/tmp/a.pdf"}' | dist/bin/kleio-capture pdf-info`.

`node dist/cli.js capture-check` checks it on this Mac: an attack page tries every way it can to
reach a canary on loopback (the canary must count 0 hits), then real pages, a phone view, a
sign-in wall, an arXiv PDF and a 404 are captured and checked (`--no-sites` skips those). It
prints where the pictures are, and fails if capture is unavailable here.

### Push nudges (APNs)

When a run ends on a session with **no device attached**, the host sends one alert push per
registered phone — a nudge only; the content replays from the ring on attach. Off unless all
of these are set for `com.kleio.host.serve`:

```
KLEIO_APNS_KEY_PATH   Apple .p8 key      KLEIO_APNS_TEAM_ID    team id
KLEIO_APNS_KEY_ID     key id             KLEIO_APNS_BUNDLE_ID  apns-topic
KLEIO_APNS_ENV        sandbox | production (default sandbox)
```

A phone registers its token with `POST /kleio/push {token, env}` (own record only; `token:
null` clears). Two completions inside 8 s produce one push. A new pairing also pushes an alert to
each admin device (see [Pair a device](#pair-a-device)).

**Pushes aren't end-to-end encrypted.** Apple delivers them, and a nudge quotes up to 170
characters of the reply, question or error (`notification-copy.ts`). Live Activities show
summaries too. Kleio's link doesn't change that.

**To quote nothing,** an admin device turns off "Quote what was said" in Settings → Connection →
Notifications (`notification-settings.ts`).

- With it off, notifications and Live Activities still name the conversation, say what happened
  ("Finished", "Needs your answer") and show a run's steps. They carry no reply, question, error,
  result or answer choices: a nudge says "Tap to see the result." and the like.
- So a question can't be answered from the lock screen then. It's answered in Kleio.
- `GET /kleio/notifications` returns `{quoteText}` to any paired device.
  `POST /kleio/notifications {quoteText}` is for admin devices.
- It's kept in `notifications.json` in the state folder (0600 off Windows; it holds no secret),
  and read at each push. Quoting is on until an admin turns it off. A file that can't be read
  means quoting off, and the log says so once.
- The check wraps the APNs pusher itself, so every push to Apple goes through it. A new
  pairing's alert names only the device and the host, so it's the same either way.

### Headless and macOS privacy prompts

The host runs its sidecar with `GG_APP_HEADLESS=1`. Under launchd, reading
`~/Desktop`, `~/Documents` or `~/Downloads` — even a `stat()` of a path below them —
blocks on a "would like to access" dialog nobody at a headless Mac can answer, and
each blocked call pins a libuv thread. With the flag, project discovery never touches
those folders; keep the mini's projects under its projects root (default
`~/gg-projects`) instead.

### Windows: secrets and stopping

**Secrets.** Windows ignores POSIX modes: a file gets the ACL its folder passes down, which under
`%LOCALAPPDATA%` lets SYSTEM and the Administrators group in as well as the user. So on Windows
the host locks each secret with `icacls` (`src/acl.ts`): inheritance removed, and one entry left,
the user the host runs as (its SID, from `whoami /user`), with full access.

- **What:** `secure/` and every file in it, `composio.key`, `typesafe.key`, `openai.key` and
  `sidecar.json` (the list at the top). `secure/` is locked as a folder (`(OI)(CI)F`), so a file
  made in it later inherits its one entry.
- **Checked:** cutting inheritance off keeps any entry given to the file or folder itself, such
  as the SYSTEM and Administrators entries Windows writes when the folder above passes nothing
  down. So each lock reads the ACL back (`icacls /save`, into a new temporary folder), removes
  every other account's entries (`icacls /remove`), and reads it again. Unless it's then the
  user's alone, with inheritance cut off, the lock fails, as it does when the ACL can't be read.
- **When:** `init` locks `secure/` before it writes a key there, then locks each key and
  `admin.token`. `serve` and `sidecar` lock all of these that exist each time they start, which
  repairs an ACL that has drifted and covers files from before the lock. A key saved from
  Settings, and `sidecar.json`, are created empty, locked, then written and renamed into place,
  so a secret is never on disk unlocked.
- **Fails closed:** a lock that fails stops `init`, `serve` or `sidecar` (exit 1), and a key
  save answers `500 internal` without writing the key. If `sidecar.json` can't be locked, the
  new endpoint isn't published, so `serve` can't reach that sidecar. The log says which file and
  why, with `icacls`'s own output; the key itself is never logged.
- **How:** `whoami.exe` and `icacls.exe` from `%SystemRoot%\System32` (`C:\Windows` unless
  `SystemRoot` is a plain drive path), with an argument array, no shell and a 10 s timeout.
- **Not covered:** an Administrator can still take ownership of the files and read them. No ACL
  stops that.

CI's Windows leg runs the real `icacls` and checks the ACL it leaves, including on a folder and a
key given other entries first (`test/acl.test.ts`).

**Stopping the sidecar.** On Windows, Node's `kill()` ends a process at once
(TerminateProcess), so the sidecar's own SIGTERM teardown would never run. There the supervisor
starts the sidecar with an IPC channel and a small preloaded shim (`src/sidecar.ts`). To stop
it, the supervisor closes the channel; the shim runs the sidecar's SIGTERM teardown, and the
supervisor kills it only if it is still running 5 s later. If the supervisor itself dies, the
channel closes too, so the sidecar shuts down instead of outliving it. macOS and Linux are
unchanged: SIGTERM, then SIGKILL after 5 s.

## Known limits

- The sidecar buffers nothing: deltas emitted while the proxy itself is down (≈0.1 s
  on a redeploy) are not recoverable. `KeepAlive` keeps that window small.
- The sidecar's `cwd` is a host path; a remote client must pick a project that exists
  on the mini.
- Sessions are tracked from creation _through the proxy_; a session created by some
  other client of the sidecar is not ring-buffered until a proxied client attaches.
- Over Kleio's link, n0's shared relays slow downloads to about 1 MB/s, and on mobile data most
  connections go through a relay (see [n0's relays](../kleio-link/README.md#n0s-relays)).
- Site previews need Tailscale for now.
