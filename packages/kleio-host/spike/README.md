# Kleio host — spike

Throwaway-quality proof of PLAN.md §5. **Do not build on this; Step 3 replaces it.**

- `host.mjs` — spawns the unmodified gg-app sidecar, reverse-proxies it on
  `127.0.0.1:8443` with a static device token, adds SSE `id:` + `Last-Event-ID` replay.
- `install-mini.sh` — launchd agent `com.kleio.host-spike` + `tailscale serve --https=8443`.
- `replay-test.mjs` — drops the SSE mid-run, resumes, checks contiguity and that the
  streamed text equals `/history`.

Deploy: `node gg-app/scripts/bundle-sidecar.mjs`, rsync `gg-app/src-tauri/sidecar/` to
`~/kleio-host-spike/sidecar/` on the mini, rsync `host.mjs` + `install-mini.sh`, run the script.

Engine files modified: **none**. The sidecar's Host allowlist is satisfied by the proxy
rewriting `Host` to loopback.

## Results (2026-09-22)

Pass criteria from PLAN.md Step 2, all met against mac-mini-1 over the tailnet:

| Check | Result |
| --- | --- |
| Unmodified sidecar under launchd on the mini, proxied at `https://mac-mini-1.<tailnet>.ts.net:8443` | ✅ `com.kleio.host-spike`, `tailscale serve --https=8443` |
| Device-token auth; sidecar Host allowlist untouched | ✅ 401 without/with wrong token; proxy rewrites `Host` to loopback |
| Session create → run → cancel via the proxy | ✅ |
| SSE `id:` on every frame, `Last-Event-ID` replay after a mid-run drop | ✅ `replay-test.mjs`: phase-2 ids contiguous from drop+1, streamed text == `/history` (local and over tailnet) |
| Real gg-app pointed at the mini (`KLEIO_HOST_URL` + `KLEIO_DEVICE_TOKEN`): session on the mini, bridge attached, run streams into the window | ✅ |
| gg-app bridge resumes with `Last-Event-ID` after socket loss | ✅ mini log `resume … from 358` |
| Kleio code isolated: `src-tauri/src/kleio/`, `src/kleio/`; `lib.rs` 3 marked points, `App.tsx` 3 lines | ✅ |
| Merge drill: `git merge upstream/main` (5.60.2 → a4e163b1) on top of the spike | ✅ 0 conflicts in `lib.rs`/`App.tsx`; all 5 `kleio:` markers intact. 9 conflicts elsewhere, all in version pins / CI / engine files upstream also edited — the normal sync workload, unrelated to Kleio code |

### Findings that shape Step 3

1. **A 45 s `tailscale down/up` does not break the TCP connection.** WireGuard is
   connectionless; the app's SSE socket survived and kept streaming. Reconnect
   only triggers on a real socket close (host restart, mini reboot, laptop sleep).
   The replay ring must therefore be sized for *those* outages, not Wi-Fi blips.
2. **Restarting the host process loses every session** (the sidecar is its child;
   the ring is in memory). Step 3 must supervise the sidecar *separately* from the
   proxy so the proxy can be redeployed without killing runs, and persist the ring
   (or re-derive it from the session `.jsonl`) so a proxy restart can still replay.
3. **The sidecar's `cwd` is a host path.** gg-app sends its own project path in
   `POST /session`; with a remote host that path must exist on the mini
   (`EACCES: mkdir '/Users/wmckie'` otherwise). Step 3's client needs a
   host-side project picker, not the local one.
4. The one-window-per-app assumption held: two concurrent SSE consumers on one
   session both received every frame from the proxy's single upstream.
5. `tailscale serve` on the mini already carries the old Kleio services on
   443 / 11443 (`com.kleio.*`, `com.atlas.*` agents). Step 3's installer must
   retire those; the spike coexists on 8443.
