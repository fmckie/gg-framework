# kleio-link

Kleio's link: the connection between the Kleio app and its host, in place of Tailscale. It's built
on [iroh](https://github.com/n0-computer/iroh) from n0, pinned at 1.4.1. The decision, and what the
prototype measured, are in
[ADR 0002](../../docs/adr/0002-kleio-link-replaces-tailscale.md). Private; not published.

This crate has both ends:

- **The app's side**, which gg-app builds in on macOS and iOS
  (`gg-app/src-tauri/src/kleio/link.rs`).
- **`kleio-link-host`**, feature `host`: the host's side. It's a program of its own, run next to
  kleio-host as the same user, so it stays up while kleio-host is redeployed.

```
Kleio app ──QUIC, end-to-end (iroh)──▶ a relay, or direct ──▶ kleio-link-host
                                                               │ paired keys only
                                                               │ TCP to 127.0.0.1:8445, opening with
                                                               ▼ KLEIO-LINK/1 <device key> <secret>
                                                         kleio-host serve, its link listener
```

## How it connects

- The app dials the host by its public key. The key, the host's relays and its direct addresses
  come from the pairing QR code, and later from `GET /kleio/link`.
- **There's no address lookup.** Nothing asks n0's DNS (`dns.iroh.link`) or pkarr where the host
  is, and nothing asks the router to open a port (no UPnP, NAT-PMP or PCP). Both ends build from
  iroh's `presets::Minimal`, with lookup cleared and port mapping off (`src/endpoint.rs`).
- Connections are QUIC: TLS 1.3 with raw public keys, end-to-end between the app's key and the
  host's. They start through a relay. Once iroh finds a direct UDP path, the packets go straight
  between the two.
- Two protocols:
  - `kleio/http/0`, HTTP to kleio-host: each connection the app's HTTP client makes to the
    link's local end becomes one QUIC stream;
  - `kleio/pair/0`, pairing: one redeem request per connection.
- kleio-link-host passes each stream to kleio-host's link listener on 127.0.0.1:8445. kleio-host
  still checks the device token on every request.
- If kleio-host is stopped, each request gets a 502, `{"error":"kleio_down"}`, so the app can say
  Kleio isn't running.

## Security

### Who gets in

- **The host's key** is 32 random bytes in `secure/link.key`, which kleio-host makes: 0600 in a
  0700 folder, or locked to the host's user on Windows. kleio-link-host never makes one. It won't
  start if the key or the upstream secret is missing, or if anyone else can read or write it or
  its folder.
- **`kleio/http/0` takes only keys on kleio-host's allow-list.** That's `secure/link-allow.json`,
  which kleio-host's device registry writes on every pairing and revoke. Before any stream is
  opened:
  - a key that was never paired is closed with code 1, `NOT_PAIRED`;
  - a revoked device's key is closed with code 5, `REVOKED`.
- **Revoking takes about 2 s.** kleio-link-host checks the list every second, and closes any open
  connection whose key has left it.
- **`kleio/pair/0` takes any key,** since a new phone isn't paired yet, but within a budget:
  - at most 10 pairings a minute, one at a time (code 2, `PAIR_BUSY`, otherwise);
  - at most 32 connections open at once that aren't known to be paired;
  - one redeem request per connection, passed to kleio-host's `POST /kleio/pair/redeem`.
- **kleio-host binds each new device to the key it paired from.**
- **The pairing code works as it always has:** single-use, for 5 minutes, with 5 wrong tries.
  - It travels only inside the encrypted connection to the key the QR code names, so only that
    host sees it.
  - The QR code never holds a token.
  - Anyone with a photo of a live QR code can still pair within its 5 minutes. So kleio-host
    pushes an alert about every new pairing to each admin device.
- **A device token is no use without its device's key:**
  - on the link, a token works only from the key its device paired with;
  - a device paired over the link isn't let in on kleio-host's API port (8443, Tailscale Serve's);
  - a device paired over Tailscale isn't let in on the link.
- **kleio-host's link listener (127.0.0.1:8445) takes only kleio-link-host.**
  - Each connection opens with one line: `KLEIO-LINK/1 <device key> <secret>`. The secret is
    `secure/link-upstream.token`, compared in constant time.
  - A connection is closed before anything else is read if that line is garbled, longer than 256
    bytes, unfinished after 5 s, or has the wrong secret.
- **kleio-host listens on loopback only.** It refuses to start on any other address.
- **In the app, the link's local end is a Unix socket only the app can use.**
  - It's 0600, in a 0700 folder: `~/.kleio/run/link.sock` on the Mac, and `tmp/kl/link` in the
    app's container on the iPhone.
  - It forwards a connection only if it comes from the app's own process, which the socket's peer
    credentials say (`LOCAL_PEEREPID` on Apple's systems).
  - The app's requests name the host `link.kleio.invalid`, which never resolves, and which
    kleio-host expects on the link.
- **The app keeps its key, token and admin credential in the Keychain.**
  - On the iPhone they can be read once the phone has been unlocked after starting, and they stay
    on that phone (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synchronized). So a
    launch while the phone is locked still finds the pairing, and a backup restored to another
    phone carries none of them: that phone starts unpaired.
  - On the Mac they're in the login Keychain.
- **No custom crypto.** It's iroh's QUIC, random keys, tokens and codes, and constant-time
  comparisons.
- **Not covered:** anything running as the host's user can read the link's secrets, as it can read
  kleio-host's other keys. So can an administrator.

### What a relay sees

A relay passes encrypted packets between two keys. It sees:

- **Both public keys,** so which app talks to which host. The keys don't change, so it can tell
  it's the same phone and host each time.
- **The IP address each end connects from.**
- **When they talk, and how much.**
- **Which protocol a connection opens,** pairing or not, which QUIC's first packet names.

It can't read or change what's sent: requests, replies, tokens and pairing codes. It can't pass for
the host or the phone either, because it doesn't have their secret keys. It can delay, drop or block
their packets. Once a path is direct, the packets stop going through the relay, though both ends
stay connected to it.

We haven't yet asked n0 what its relays log. That question, and its terms for a released app, are
for n0 before Kleio ships on its relays.

Others see a little too:

- **The two networks** see each end talking to a relay, or to the other end on a direct path.
- **DNS resolvers** see the relays' names looked up. That's the system's resolvers, then iroh's
  built-in public resolvers if every system resolver fails.
- **Apple delivers push notifications,** and they aren't end-to-end encrypted. kleio-host quotes up
  to 170 characters of a reply, question or error in each, and Live Activities show summaries too.
  The link doesn't change that.

### What still needs Tailscale

- **Site previews** open in Safari over Tailscale for now. A host with no public URL has none.
  - The pairing keeps the host's preview origin, and the app opens previews only there.
  - Before asking for a preview, the app checks it can reach that origin. With Tailscale off, it
    says to turn it on, rather than open a page Safari can't load.
- **The Apps (Composio) sign-in** ends on `<public URL>/kleio/connections/callback`. A host without
  one sends Composio no callback, so the sign-in ends on Composio's own page. The sign-in still
  works.

## Relays

### The list

kleio-host keeps the relay list in `link/config.json`, in its state folder:

```json
{ "version": 1, "listVersion": 0, "relays": ["n0"] }
```

- **Without the file,** it's n0's relays alone.
- **Up to 4 entries, in order, none twice.** Each is either:
  - `https://<host>[:<port>]/`, with no path, query or credentials;
  - `"n0"`, standing for n0's 4 public relays as this crate has them built in (iroh's
    `defaults::prod`).
- **`listVersion`** goes up by one each time the list changes. `GET /kleio/link` gives it to phones
  with the list.
- **An admin changes it** in the app, under **Settings → Connection → Relays**, or with
  `PUT /kleio/link/relays` (kleio-host's README, "Changing the relay list").
- **A changed list reaches devices before the host moves.** Until every device on the link seen in
  the last 30 days has it, `relays` keeps the host on relays they know, `list` holds the new list,
  and `promoted` the last one they all had. kleio-link-host reads `relays` and ignores the rest
  (`tests/fixtures/relay-config.json`).
- **A list that can't be read** stops kleio-link-host from starting, rather than leave it on n0's
  relays when the list may leave them out. A change that can't be read while it runs is logged, and
  the last good list stays.

### Which relay the host is on

The host is on exactly one relay at a time, pinned as its home relay. With no address lookup, a
phone finds the host only on relays it knows. And a relay drops packets for a key that isn't
connected to it.

- **It starts** on the first relay in the order that answers `GET /ping`. n0's entry counts as its
  relays, fastest first.
- **Failover:** after 15 s without its relay, it moves to the next in the order that answers. While
  none does, it stays put: then it's the host's network that's down.
- **Failback:** on any relay but the first, it asks those ahead of it every 30 s. It moves back to
  one once that relay has answered for 5 minutes.
- **A changed list** is read within 5 s. A relay that's no longer on it is left at once.
- **`serve --relay <url>`** pins one relay for good, and the list isn't read.

It writes where it is to `link/state.json`. kleio-host reads that for tickets, `GET /kleio/link`
and `kleio-host status`.

### How the app dials

A dial (`Route`, in `src/link.rs`) has the host's key, its relay list, the relay it was last
reached through, and its last direct addresses. It goes in two stages:

1. **For up to 4 s:** the host's last relay and its last direct addresses.
2. **Then, until 10 s:** every relay in the list as well.

The relay that worked becomes the app's only relay. So with a list without `"n0"`, the app never
contacts n0's relays either.

**After each new connection,** the app asks the host for `GET /kleio/link`: its relay list, its
direct addresses, and whether a relay is rate-limiting it. The next dial uses them, and `link.json`
keeps them for the next launch. It takes them only from the host it dialled, and only a list a
pairing QR code could carry.

**When a dial finds no host,** the link works out why:

- **A relay answered, and the host didn't.** A connected home relay says so at once. The app says
  "[Host] is asleep or offline. Last reached [time].", with a line for a laptop or a VPS.
- **No relay answered.** The app asks each relay on the route `GET /ping`, in the background, and
  none answers as a relay. It says "Kleio can't reach its relay. This network may block it: try
  mobile data or another Wi-Fi.", and names the relays it tried.
- **A relay turned this version away.** It answers `/ping`, but refuses this app's relay
  connection. The app asks for an update.

The app's words for each case, and the restart steps for the host's OS, are in `diagnoseLink`
(`gg-app/src/kleio/connectionDiagnosis.ts`). While the app is on screen, it checks again after 1,
2, 5 and 10 s, then every 30 s, and at once when the network or the app comes back. It doesn't
check in the background.

**Once the host turns the app's key away** (code 1 or 5), the link never dials it again: every
request fails at once with that answer, until the app pairs again with a new key, or is opened
again. Before this, a revoked phone dialled 185 times in 124 s, once for each request the app
retried.

### n0's relays

n0's public relays are the default. They're free, shared with other apps, and rate-limited. The
prototype measured, through them:

- **Downloads:** 2.12 MB/s for the first 5 MiB, then 1.06–1.31 MB/s. 45 MiB took 44.5–44.7 s.
  Chats weren't affected: a 667-message chat opened in under 0.9 s.
- **Mobile data:** on EE 4G no connection went direct (0 of 11).
- **Wi-Fi:** every connection the log could see went direct (10 of 10, with Tailscale off).
- **Overall,** 73% of the test phone's connection time went through the relay.

Phase 2 measured, in the real app on EE 4G, a 45 MiB file at 0.57 MB/s. While it came, the
connection's round trip went from 0.1 s to 8.8 s, so chats waited up to about 20 s behind it. As
in the prototype, no connection went direct on EE 4G.

That was QUIC's default congestion control, Cubic, which slows down only when packets are lost. A
shared relay doesn't drop what's over its limit, it reads it more slowly, so the file's data
queued in the relay's path and everything else waited behind it. So kleio-link-host now runs
BBRv3 (`transport` in `src/host/mod.rs`), which paces at the rate the path delivers and keeps
about a round trip's worth in flight:

- Through a test relay limited to 1 MiB/s, with a 45 MiB file (`tests/pacing.rs`), requests
  alongside it took 0.2 s at most, against 1.2–2.1 s with Cubic. The file came at 95% of the
  limit either way.
- With 5 MiB let through faster first, as n0's relays do, the slowest request took 0.25 s.
- With two big files at once, it took 0.19 s.
- On a direct path BBRv3 measured the same as Cubic.

Only the host's end changed, as only the host sends big answers. The phone keeps iroh's default,
so a big upload from the phone still queues. Downloads get no faster: a relay of your own is what
makes them faster.

kleio-link-host notes when a relay says it's rate-limiting the host (`rateLimited` in
`link/state.json`). A relay of your own avoids the limit: put it first in the list, with `"n0"`
after it as the fallback.

The app says a relay is slowing it in three cases, for as long as that connection lasts:

- the relay told the phone so;
- the relay told the host so;
- a download of 10 MB or more through a relay came slower than 1.5 MB/s.

It then says "Slowed by the shared relay, to about 1 MB/s. Chats are slower while a file
downloads. A relay of your own is faster."

So the app's downloads have no time limit, only a limit on waiting: a download stops when nothing
has come from the host for 20 s. Until then, the file's card says how much has come, and about how
long is left, by the last 5 s' rate.

### Run your own relay

A relay of your own isn't rate-limited, so downloads go as fast as its connection. It forwards the
link's packets without being able to read them, as n0's do. It needs a machine with a public
address, such as a small VPS, and a DNS name for it.

**Get iroh-relay 1.4.1,** the version kleio-link is built with:

- from n0's releases, <https://github.com/n0-computer/iroh/releases/tag/v1.4.1>:
  `iroh-relay-v1.4.1-<target>.tar.gz` for Linux and macOS, and a `.zip` for Windows;
- or with Rust: `cargo install iroh-relay --version 1.4.1 --features server --locked`.

**Open these ports to it:**

- **TCP 443:** the relay itself, over HTTPS, and Let's Encrypt's check;
- **TCP 80:** a captive-portal check that iroh's clients make;
- **UDP 7842,** if you turn on `enable_quic_addr_discovery`: it helps devices find a direct path.
  The relay works without it.

**Write its config,** for example `/etc/iroh-relay/config.toml`, with your relay's name and an
email for Let's Encrypt:

```toml
# Its metrics listen on every address (port 9090) unless told otherwise.
enable_metrics = false

# Let's Encrypt over TLS-ALPN-01 on port 443: no web server needed.
[tls]
cert_mode = "LetsEncrypt"
hostname = "relay.example.com"
contact = "you@example.com"
cert_dir = "/var/lib/iroh-relay"
```

Settings of its own, like `enable_metrics`, go above `[tls]`: TOML puts what follows a table into
it. Run it with `iroh-relay --config-path /etc/iroh-relay/config.toml`. It binds ports 80 and 443,
so as a systemd service give it `AmbientCapabilities=CAP_NET_BIND_SERVICE` rather than running it
as root.

**Check it answers** as a relay does, with 200 and nothing else:

```sh
curl -si https://relay.example.com/ping | head -1
```

**Add it in Kleio,** under **Settings → Connection → Relays**, above `n0`. Keep `n0` after it as
the fallback. The host moves to it once every device has the new list, or at once with **Use it
now**.

**Who may use it.** Without an `access` setting, anyone can relay through it, though only your
devices' packets mean anything. To let in only your host and devices, list their keys, above
`[tls]`:

```toml
access.allowlist = [
  "<the host's key: kleio-link-host id>",
  "<each device's key: link-allow.json>",
]
```

- The host's key is what `kleio-link-host id` prints. Each paired device's is in the state
  folder's `secure/link-allow.json`, under `devices`, as `key`.
- The list doesn't reload: restart iroh-relay after changing it.
- **A new device isn't on it yet when it pairs,** so it finds the host through the next relay in
  the list. Keep `n0` in the list, and add the new device's key after pairing.
- iroh-relay's `shared_token` and `http` access need the client to send a token, which Kleio's
  link doesn't, so use `allowlist`.

## The files it shares with kleio-host

They're in kleio-host's state folder, the same one for both programs:

- `$KLEIO_HOST_HOME`, if it's set;
- otherwise `~/Library/Application Support/Kleio/host` on macOS, `%LOCALAPPDATA%\Kleio\host` on
  Windows, and `$XDG_STATE_HOME/kleio/host` (or `~/.local/state/kleio/host`) on Linux.

| File                         | Written by                                        | What it holds                                                                   |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `secure/link.key`            | kleio-host (`init`, and `serve` on an older host) | The host's secret key, 32 bytes.                                                |
| `secure/link-upstream.token` | kleio-host, likewise                              | The secret kleio-link-host opens each connection to the link listener with.     |
| `secure/link-allow.json`     | kleio-host's device registry                      | Paired devices' keys, and revoked ones.                                         |
| `link/config.json`           | kleio-host                                        | The relay list (above).                                                         |
| `link/state.json`            | kleio-link-host                                   | Its key, relay, direct addresses, each relay's health, connections, last paths. |

- kleio-link-host reads the allow-list and the secret again whenever they change.
- It rewrites `link/state.json` on any change, and at least every 30 s. kleio-host takes a file
  more than 90 s old to mean kleio-link-host isn't running.

## Running it

```sh
kleio-link-host serve [--state-dir <dir>] [--upstream 127.0.0.1:8445] [--relay <url>]
kleio-link-host qr [--color]             # the ticket on stdin as a terminal QR code
kleio-link-host id [--state-dir <dir>]   # this host's public key
kleio-link-host client --ticket <file> --listen 127.0.0.1:<port> [--pair]   # a test client
kleio-link-host help                     # all of it, with the test options
```

- **Start kleio-host before kleio-link-host.** kleio-host makes the key and the secret, and on
  Windows it locks them.
- **Defaults:** `serve` and `id` take kleio-host's default state folder, and `serve` forwards to
  `127.0.0.1:8445`. If kleio-host runs with `KLEIO_HOST_HOME` or `KLEIO_LINK_PORT` set, give
  kleio-link-host the same folder (`--state-dir`) and port (`--upstream`).
- **`kleio-host pair` runs `qr` itself.** It looks for the binary in `bin/` beside its `dist/`, or
  at `KLEIO_LINK_HOST_BIN`. `qr` reads the ticket on stdin, so the code never shows in a process
  list.
- **The test client's requests need the link's `Host`.** kleio-host refuses `Host: 127.0.0.1:<port>`
  on the link, so through `client`, use
  `curl -H 'Host: link.kleio.invalid' http://127.0.0.1:<port>/kleio/health`.
- **Logs go to stderr.** `RUST_LOG` takes `target=level` pairs, such as `kleio_link=debug`. Logs
  name keys by their short form, with each connection's protocol, outcome and path events. They
  never hold a code, nonce, token or secret.
- **It needs no root, and no port opened to it.** It listens on no TCP port, and a relay needs
  nothing incoming. If a firewall asks whether to let it take incoming connections, either answer
  works: on the mini, a direct path still formed with them blocked.

### On the mini (macOS)

- `install-mini.sh` runs it as the launchd job `com.kleio.host.link`.
- `deploy-mini.sh` builds it for Apple silicon and copies it to `~/kleio-host/bin/`.
- [packages/kleio-host/README.md](../kleio-host/README.md#install-on-the-mini) has the details.

### On Linux

kleio-host has no Linux installer yet. These steps are for kleio-link-host only, next to a
kleio-host that already runs there as your user.

1. **Build it.** You need Rust 1.91 or later and a C compiler (`build-essential` on Debian and
   Ubuntu):

   ```sh
   cd packages/kleio-link
   cargo build --release --locked --features host --bin kleio-link-host
   install -D -m 0755 target/release/kleio-link-host ~/kleio-host/bin/kleio-link-host
   ```

   `~/kleio-host/bin/` is where the unit runs it from. `kleio-host pair` finds it there when
   kleio-host's `dist/` is in `~/kleio-host`, as on the mini. Otherwise, set `KLEIO_LINK_HOST_BIN`
   to its path wherever you run `kleio-host pair`.

2. **Start kleio-host,** so the key and the secret exist: `kleio-host init` once, then
   `kleio-host serve`.

3. **Install the systemd user unit** (`contrib/kleio-link.service`) and start it:

   ```sh
   install -D -m 0644 contrib/kleio-link.service ~/.config/systemd/user/kleio-link.service
   systemctl --user daemon-reload
   systemctl --user enable --now kleio-link.service
   journalctl --user -u kleio-link.service -f   # its log
   ```

4. **Match kleio-host's settings.** If kleio-host runs with `KLEIO_HOST_HOME`, `XDG_STATE_HOME` or
   `KLEIO_LINK_PORT` set, give the unit the same folder and port. Run
   `systemctl --user edit kleio-link.service`, then add:

   ```ini
   [Service]
   Environment=KLEIO_HOST_HOME=/srv/kleio/host
   Environment=KLEIO_LINK_PORT=8445
   ```

   Here `KLEIO_HOST_HOME` is the state folder itself. With `XDG_STATE_HOME`, that's
   `$XDG_STATE_HOME/kleio/host`.

5. **On a server nobody logs in to,** run `loginctl enable-linger` once. Then your user's services
   start at boot and keep running after you log out. Some systems ask for an administrator's
   password.

`kleio-host status` then shows the link on a relay.

### On Windows

There's no Windows installer for kleio-host or the link yet. For now kleio-link-host runs in a
terminal of its own.

1. **Build it** with Rust 1.91 or later and the MSVC toolchain:

   ```powershell
   cd packages\kleio-link
   cargo build --release --locked --features host --bin kleio-link-host
   ```

   Copy `target\release\kleio-link-host.exe` into `<install>\bin\`, where `<install>` is the
   folder that holds kleio-host's `dist\`. That's where `kleio-host pair` looks for it;
   `KLEIO_LINK_HOST_BIN` overrides it.

2. **Start kleio-host first.** `serve` and `sidecar` lock its secrets to your user each time they
   start. kleio-link-host refuses a key or secret whose ACL lets anyone else in.

3. **Run it** as the same user, and leave the window open:

   ```powershell
   & "<install>\bin\kleio-link-host.exe" serve
   ```

   It takes kleio-host's defaults: the state folder `%LOCALAPPDATA%\Kleio\host` (or
   `KLEIO_HOST_HOME`), and the link listener `127.0.0.1:8445`. If kleio-host runs with others, pass
   `--state-dir` and `--upstream`.

Signing out stops it.

Neither the unit nor the Windows steps has run on a real Linux or Windows host yet. CI builds and
tests the crate on both, and runs it end to end with kleio-host.

## Build and test

```sh
cd packages/kleio-link
cargo fmt --check
cargo clippy --locked --all-targets --features host -- -D warnings
cargo test --locked --features host
# End to end with the real kleio-host: build it first (pnpm --filter @kleio/host build).
cargo test --locked --features host --test end_to_end -- --ignored
```

- **`tests/relayed.rs`** runs with relays in the test process and a stand-in for kleio-host, so it
  needs no network. It covers pairing (and a used, wrong or expired code), telling a missing relay
  from a missing host, the codes a stranger and a revoked device get, a revoke within 2 s, the 502,
  failover, and a relay's rate limit.
- **`tests/end_to_end.rs`** runs the real kleio-host and kleio-link-host, with a relay and a phone
  in the test process. CI runs it on Linux, macOS and Windows.
- **`tests/pacing.rs`** sends a 45 MiB answer through a relay limited to 1 MiB/s, with a request
  alongside it each second. Each must take under 1 s, and the answer must come at 90% of the limit
  or better. It takes about 50 s.
- **iroh is pinned** (`=1.4.1`), and noq-proto with it (`=1.4.0`, iroh's own, for the host's
  BBRv3). gg-app's lockfile and this one must agree on iroh's and noq's versions.
  `node scripts/check-link-locks.mjs` checks that, and CI runs it. Dependabot updates both
  lockfiles in one group.
