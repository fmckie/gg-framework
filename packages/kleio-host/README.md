# @kleio/host

Runs the fork's gg-app sidecar on a headless Mac and fronts it over Tailscale
for paired devices. Private workspace package; not published. The sidecar
carries two engine changes Kleio relies on (persisted routines and
`GG_APP_HEADLESS`); see the header of `src/host.ts`.

```
laptop / phone ──HTTPS (tailscale serve :8443)──▶ kleio-host serve ──HTTP loopback──▶ app-sidecar.mjs
                                                   │ device tokens, pairing,            ▲
                                                   │ SSE id + replay ring               │ supervised by
                                                   └──────────── sidecar.json ◀──── kleio-host sidecar
browser on the device ──HTTPS (tailscale serve :8444)──▶ kleio-host serve, preview origin only
```

Two ports, both Tailscale Serve (tailnet only, never Funnel):

| Port   | Env                                       | Serves                                                                                 |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `8443` | `KLEIO_HOST_PORT`, `KLEIO_PUBLIC_URL`     | The API. A paired device's token on all but health, pairing and the Composio callback. |
| `8444` | `KLEIO_PREVIEW_PORT`, `KLEIO_PREVIEW_URL` | Agent-written web pages, by short-lived link only. No API routes.                      |

`KLEIO_PREVIEW_URL` defaults to `KLEIO_PUBLIC_URL` with the preview port.

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
sh kleio-host/install-mini.sh cli      # only the `kleio-host` command, no restarts
```

The installer also writes a `kleio-host` command to `~/.local/bin` (no sudo) and adds
that folder to PATH in `~/.zprofile` once, so login and SSH shells can run it. It uses
the same node and `dist/cli.js` as the launchd jobs.

The installer retires the earlier `com.kleio.*` / `com.atlas.*` / `com.hermes.*` /
`com.noledge.*` user agents (plists moved to `LaunchAgents/retired-by-kleio-host/`),
creates keys and the first admin device, and points `tailscale serve --https=8443` and
`--https=8444` at the host (`uninstall` turns both off; `tailscale serve status` shows
them). Root-owned leftovers under `/Library/LaunchDaemons` are unloaded if `sudo -n`
allows it; otherwise they are listed with the one `sudo mv` to run (they are disabled
in launchd and cannot start, so this is cleanup, not a blocker).

## Pair a device

```sh
kleio-host pair            # prints ABC-DEF, 5 min, single use
kleio-host pair --admin    # also grants a control macaroon
kleio-host devices
kleio-host revoke <deviceId>
ssh mini 'zsh -lc "kleio-host devices"'   # from the laptop
```

The device POSTs `{ code, redemptionNonce, label }` to `/kleio/pair/redeem` and
receives `{ baseUrl, host, token, label, deviceId, controlCredential? }`. Every later
request carries `x-kleio-device-token` (admin devices add `x-kleio-control`).
`GET /events?session=…` frames carry `id:`; reconnect with `Last-Event-ID` and the
host replays what was missed (persisted ring, survives a host restart). Revoking a
device closes its open streams immediately.

### From gg-app (the laptop)

1. On the mini: `kleio-host pair --admin` → `ABC-DEF`.
2. In gg-app: **⌘⇧K** → host URL (`https://mac-mini-1.<tailnet>.ts.net:8443`) + the
   code → **Pair** → **Restart now**.
3. The title strip shows **on mac-mini-1**; sessions now run there. The picker lists
   the mini's projects; "New project" points you at the mini.

The token and control credential go to the login Keychain (`com.kleio.gg-app`), the
non-secret record to `~/.gg/kleio-remote.json`. Admin actions in the pane's
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
- **Handing on:** a reply that `@mentions` another member passes the turn to them. The limit is
  6 Blob turns per message of yours.
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
  redirects to `kleio://connections?status=success|failed`.

**Errors:** with no key, the list says `configured:false` and the other routes answer 503. A
Composio error is a 502 `{error:"composio", status, detail}`.

**Key:** set `KLEIO_COMPOSIO_API_KEY`, or put the key in `<state dir>/composio.key` (mode 0600;
`~/Library/Application Support/Kleio/host/composio.key` on the mini), then restart the host. The
key never appears in a response or log.

**Privacy:** Composio sees tool arguments and results and stores the app logins. It is less
private than Tinfoil.

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
- **Responses:** always a download (`content-disposition: attachment`, `nosniff`). HTML, SVG
  and scripts come back as `application/octet-stream`, so nothing an agent writes runs on the
  API origin.

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
  when the host runs without a preview port.
- **Logs:** never include the link's token.

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
null` clears). Two completions inside 8 s produce one push.

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
