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
