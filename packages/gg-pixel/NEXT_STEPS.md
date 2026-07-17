# gg-pixel — Next steps

State as of **gg-pixel 4.3.80**. This file is the canonical handoff for any
agent picking up the work — read it before starting anything.

## Repo layout (source of truth)

| Package                                      | Path                        | What it is                                 | npm/cargo/etc.                               |
| -------------------------------------------- | --------------------------- | ------------------------------------------ | -------------------------------------------- |
| **JS SDK** (Node + Browser + Deno + Workers) | `packages/gg-pixel/`        | All-in-one with subpath exports            | `@kenkaiiii/gg-pixel` (published)            |
| **JS backend**                               | `packages/gg-pixel-server/` | Cloudflare Worker + D1 (the ingest server) | private, deployed                            |
| **CLI / runner**                             | `packages/ggcoder/`         | `kleio-coder pixel` TUI + agent fix queue  | `@kleio/coder` (published)                   |
| **Python SDK**                               | `packages/gg-pixel-py/`     | wheel built at 4.3.68; **NOT yet on PyPI** | `gg-pixel` (PyPI, blocked)                   |
| **Rust SDK**                                 | `packages/gg-pixel-rs/`     | crate at 4.3.72; **NOT yet on crates.io**  | `gg-pixel` (crates, blocked)                 |
| **Go SDK**                                   | `packages/gg-pixel-go/`     | module; **NOT yet pushed to GitHub**       | `github.com/kenkaiiii/gg-pixel-go` (blocked) |
| **Ruby SDK**                                 | `packages/gg-pixel-rb/`     | gem; **NOT yet on RubyGems**               | `gg_pixel` (gem, blocked)                    |
| **Swift SDK**                                | `packages/gg-pixel-swift/`  | SPM package; **NOT yet pushed/tagged**     | SPM via Git URL (blocked)                    |

Verified live end-to-end against the deployed worker:
**Node, Browser, Deno, Bun, Cloudflare Workers (via wrangler dev), Python (local), Rust (local), Swift (local), Go (local), Ruby (local), source maps (real esbuild bundle)**.

---

## 1. Publish the standalone-SDK packages (BLOCKED on credentials)

For each, the artifact is already built and locally verified. The blocker is that
the autonomous agent doesn't have publish credentials. After Ken runs each
publish step ONCE, end users can install via the platform's standard flow.

### Python → PyPI

```bash
cd packages/gg-pixel-py
# 1. Create a token at https://pypi.org/manage/account/token/
#    (scope "Entire account" for first publish, narrow to project after)
# 2. Either save to ~/.pypirc:
#    [pypi]
#    username = __token__
#    password = pypi-XXX
# 3. Upload:
twine upload dist/*  # the .whl + .tar.gz are already built
```

After publish, `pip install gg-pixel` works. The Python install path in
`kleio-coder pixel install` will then work hands-off for Python projects.

### Rust → crates.io

```bash
cd packages/gg-pixel-rs
# 1. Get a token from https://crates.io/me
# 2. cargo login <token>
# 3. cargo publish
```

After publish, `cargo add gg-pixel` works.

### Go → GitHub (Go modules don't need a registry)

```bash
cd packages/gg-pixel-go
# 1. Create the repo: gh repo create kenkaiiii/gg-pixel-go --public
# 2. Push the directory contents
# 3. Tag the version: git tag v4.3.72 && git push --tags
```

After: `go get github.com/kenkaiiii/gg-pixel-go@v4.3.72` works.

The `kleio-coder pixel install` flow already runs `go get
github.com/kenkaiiii/gg-pixel-go@latest` — so once the repo + tag exist, Go
projects work hands-off.

### Ruby → RubyGems

```bash
cd packages/gg-pixel-rb
gem build gg_pixel.gemspec
gem push gg_pixel-4.3.72.gem
# (creates a credential interactively the first time)
```

After: `gem install gg_pixel` works.

### Swift → GitHub + tag (SPM consumes Git directly)

```bash
cd packages/gg-pixel-swift
# 1. Create the repo: gh repo create kenkaiiii/gg-pixel-swift --public
# 2. Push the directory contents
# 3. Tag: git tag 4.3.72 && git push --tags
```

After: users add `.package(url: "https://github.com/kenkaiiii/gg-pixel-swift",
from: "4.3.72")` to their `Package.swift` (or via Xcode → File → Add Packages).

---

## 2. Not built yet (need toolchains the agent doesn't have)

### Android (Kotlin) SDK

**Why it's not built**: no Gradle / Android SDK / Kotlin compiler in the
current dev environment. Cannot verify a build without those.

**To unblock**:

1. `brew install --cask android-commandlinetools`
2. Install Android SDK platform: `sdkmanager "platforms;android-34" "build-tools;34.0.0"`
3. Install Gradle: `brew install gradle`

**Pattern to follow** (verified via Grep MCP against Sentry/Bugsnag Kotlin SDKs):

- Library module published to Maven Central or JitPack
- `Thread.setDefaultUncaughtExceptionHandler` for JVM-level uncaught
- `OkHttp` for the HTTP sink (or `HttpURLConnection` with no extra deps)
- Wire format: same JSON as everywhere else
- Manual API: `GGPixel.init(context, projectKey)` + `GGPixel.report(...)` + `GGPixel.captureException(e)`

Add `kleio-coder pixel install` detection: `build.gradle` or `build.gradle.kts`
present → kind = "android".

### React Native SDK

**Why it's not built**: needs an Expo or RN CLI dev environment + a working
simulator to verify hooks fire. The runtime is neither browser nor Node, so
neither existing SDK works correctly.

**To unblock**:

1. `npm install -g expo-cli`
2. Have Xcode iOS simulator available

**Pattern**:

- New `@kenkaiiii/gg-pixel/react-native` entry in the existing npm package
- Hook `ErrorUtils.setGlobalHandler(...)` (RN-specific JS global)
- Send via the existing `HttpSink` (fetch is available in RN)

`kleio-coder pixel install` already detects `react-native` in deps and emits a
clear "not yet supported" warning rather than installing something broken.

### Java (server-side) SDK

**Why it's not built**: macOS system has `javac` but no working `java`
runtime — needs `brew install openjdk`.

**Pattern**:

- Maven artifact published to Maven Central
- `Thread.setDefaultUncaughtExceptionHandler` (JVM-level)
- HTTP via `java.net.http.HttpClient` (stdlib, no deps)

### .NET / PHP / others

Not built. No toolchains installed. Pattern would mirror the others (drop-in
SDK, language-native uncaught hook, same wire format). Each is a real chunk
of work — at least a day of focused effort per language.

---

## 3. Live verification status

`kleio-coder pixel install` is unit-tested for detection across all listed
frameworks. **Runtime e2e** has been done for the most common ones:

| Framework                 | Live verified?                  | Notes                                                                                                                                                        |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Next.js**               | ✅ Live e2e (4.3.76+)           | `create-next-app`, install, throw in API route + manual report — both landed in D1                                                                           |
| **Electron** main process | ✅ Live e2e (4.3.78+)           | Real Electron app, throw in main, sync emit via curl works                                                                                                   |
| **Electron** renderer     | ⚠️ Bundler-required             | Vanilla `<script>` can't resolve npm specifiers. Real Electron apps use webpack/Vite via electron-forge — those work because the bundler resolves the import |
| **SvelteKit**             | ✅ Live e2e (4.3.80)            | Server hooks fire on API route throw; landed in D1                                                                                                           |
| **Nuxt**                  | ⚠️ Wiring code-correct, not e2e | Same hooks pattern as SvelteKit; high confidence                                                                                                             |
| **Remix**                 | ⚠️ Wiring code-correct, not e2e | Entry-file injection same pattern as Next client                                                                                                             |
| **Tauri** (frontend)      | ⚠️ Wiring code-correct, not e2e | Frontend = browser SDK (verified independently); Rust backend has no SDK                                                                                     |
| **React Native**          | ❌ Explicitly skipped           | Not supported until a real RN SDK is built                                                                                                                   |

To finish the runtime sweep: scaffold the remaining ones (`npx nuxi init`,
`create-remix@latest`, `create-tauri-app`) and run the same loop —
install → throw → verify in D1.

---

## 4. Cloudflare Workers — same-account caveat

When a user deploys to Cloudflare AND their worker is on the same Cloudflare
account as the gg-pixel-server (`buzzbeamaustralia` — Ken's account), fetches
to `https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest` get
**error 1042** (Cloudflare's worker→worker same-account block).

**Fixes:**

1. **Best**: add a custom domain to `gg-pixel-server` (e.g.
   `pixel.kenkai.dev`) and update `DEFAULT_INGEST_URL` everywhere.
2. **For Ken's own apps**: use a Cloudflare Service Binding instead of HTTP
   (`env.PIXEL.fetch(...)` instead of `fetch(url)`).

For users on **different** Cloudflare accounts: no issue (verified via
`wrangler dev`).

---

## 5. Source maps — server-side upload (deferred to v2)

Current resolution is **client-side**: works only when `kleio-coder pixel`
runs from the project dir AND there's a local `dist/` with `.map` files.

**For deployed-and-disconnected scenarios** (dev's machine has no build),
need server-side symbolication:

1. Add `R2` bucket to `gg-pixel-server` worker
2. New endpoint `POST /api/projects/:id/sourcemaps` (uploads `.map` files,
   stored by `release + filename`)
3. Browser SDK: send `release` field on each event (e.g.
   `import.meta.env.GG_PIXEL_RELEASE`)
4. Server-side resolution at fetch time: when the runner queries an error,
   the worker resolves the stack using R2-stored maps before returning.

Estimated effort: ~1 day. Sentry's pattern for reference:
[sentry-cli sourcemaps](https://docs.sentry.io/cli/sourcemaps/).

---

## 6. Other backlog items (each ~hours, none blocking)

- **Heartbeats / uptime monitoring** — SDK pings every N minutes,
  dashboard shows green/red. Decided against in original spec.
- **Notifications** — email / Slack / push when an error lands. Deferred.
- **Per-project rate limit on the backend** — currently the worker trusts
  any valid `project_key`; a single abused key has no cap.
- **Multi-tenant auth on the dashboard** — gg-pixel-server has no auth; any
  caller with a `project_id` can read errors. Fine for single-user; needed
  before opening to clients.
- **Drop-telemetry to the backend** — when the SDK retries-then-drops, only
  stderr gets the warning. Could send a special "drops" record so the
  dashboard knows.
- **`gg-editor` lint errors** — pre-existing in another package, unrelated
  to pixel work. Fix or wave away.

---

## 7. Where the canonical spec lives

`packages/gg-pixel/SPEC.md` is the original design doc. It's been kept
roughly current (e.g. updated for `event_id` and `in_app`), but is no
longer the most accurate description of the multi-SDK reality. The most
current truth is:

- This file (`NEXT_STEPS.md`) for what's left
- `packages/gg-pixel/src/` for the JS multi-runtime SDK
- Each `packages/gg-pixel-{rs,py,rb,go,swift}/` for native SDKs
- `packages/gg-pixel-server/src/` for the backend

---

## 8. Quick agent-orientation cheat sheet

If you're a coding agent that just picked this up:

1. **Read `packages/gg-pixel/SPEC.md`** for the design vision (one paragraph)
2. **Read `packages/gg-pixel-server/migrations/0001_init.sql`** for the data model
3. **Run the existing tests** in each package to confirm everything green
4. **Pick one item from sections 1–6 above** and ship it
5. **Don't ship "maybes"** — Ken's repeated rule. Either verify end-to-end
   against the live worker, or be explicit about what isn't verified.
