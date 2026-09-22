# Upstream provenance

This repository is the Kleio-owned downstream fork of
[`KenKaiii/gg-framework`](https://github.com/KenKaiii/gg-framework).

## First engine integration (merged)

PR [#1](https://github.com/fmckie/gg-framework/pull/1) imported upstream
`3a4eb7e83fe19eebc74aa539d5fa940822f8cdd1` (engine **5.59.3**, desktop **0.63.3**)
and merged at `2a4ba011806ba6795b44c96d2b76261cfd3c98b2`. All six framework/app
Linux, macOS and Windows jobs passed in post-merge run **34973614641**, including
the blocking Windows installer build-and-launch smoke.

## Next 44 commits (2026-09-15)

- Pinned upstream snapshot: `fdab3f18ff204fbae2846686a7a7a2a3e8e04d94`
- Engine **5.60.2**, desktop **0.65.0**: 44 commits after the first integration
- Integration base: `2a4ba011806ba6795b44c96d2b76261cfd3c98b2`
- Branch: `sync/upstream-fdab3f18`; `main` stays unchanged
- PR: [#2](https://github.com/fmckie/gg-framework/pull/2), merged at `99073ea3`
- Integration commit: `9972757d69935e8fe7041316646acac30e5b0942`
- Verification gates: `79735cb4`; hosted-runner fixes and dependency overrides in
  [#3](https://github.com/fmckie/gg-framework/pull/3)

**Released as 5.60.2-kleio.1.** From this release the fixed version is
`<imported engine version>-kleio.<n>` (enforced by `scripts/verify-fixed-versions.mjs`
against `fork-provenance.json` `upstream.lastImportedVersion`), so a package never
claims an engine it does not contain. The original fork point and its immutable
baseline below remain unchanged.

### Projects maintained downstream

Unlike upstream, this fork retains standalone `@kleio/manager` in
`packages/gg-boss`, Editor and the Premiere panel, all Pixel SDKs and its server,
Voice, Coder Eyes, Matey, and experiments. Their workspace membership, commands,
exports, tests, and supporting assets remain active. Compatibility adaptations
use the newer shared engine; these projects are not archived or replaced by a
second engine copy. This deliberate divergence requires ongoing maintenance.

`gg-app` is an additional imported workspace member. Its upstream app identity
is distinct from Kleio Desktop; its release jobs are guarded to run only in
`KenKaiii/gg-framework`. The Kleio Desktop repository, vendored bridge, separate
Manager surface, runtime dependency pins, and real session data are unchanged.

`SessionInfo.firstPrompt` remains optional bounded raw text captured in the same
stream pass as the newer, normalized `preview`. Archive handling, checkpoint
selection, redaction, and storage normalization remain upstream implementations.

The workspace, Ink patch, security overrides, explicit build allowlist, fork
release guards and Windows CI fixes remain intact. Two additional upstream UI
patches preserve production style nonces. Zod 4 is pinned to upstream's **4.5.4**
across the workspace to prevent incompatible schema types from mixed versions.

Internal diagnostics remain opt-in. Argument identifiers (even short ones) and
normalized errors are hashed; raw error samples are never stored. Project paths
are hashed, existing secret redaction is reused, maps/records/reads are bounded,
and validated records are privately written by temp-then-rename. Old raw-format
files are excluded from aggregation. Regression tests use disposable synthetic data.

### Verification record

Local macOS verification passed: complete workspace build/typecheck/test, lint,
formatting, fixed versions, staged and packed identity checks, actual five-package
archives with byte-for-byte audit parity, identity negative tests, runtime staging,
sidecar bundle/smoke, all three size gates, startup gate, **515 desktop tests**,
frontend production build, **77 Rust tests**, and unsigned native production build
(`tauri build --no-bundle`). Existing opt-in live/LSP tests remain unrun; no test or
CI gate was disabled by this integration.

The frontend initially exceeded its unchanged size gate at **859.2 KiB**. Deferring
closed settings/model-setup dialogs reduced initial JavaScript to **837.1 KiB**;
no thresholds were relaxed. Regression tests cover real lazy dialogs, saving,
Escape/focus return, and no automatic model download. The shared modal captures
its opener before child autofocus, preserving keyboard focus on close. Seven
retained files received only formatting required by the new Prettier version.

Tauri JS/Rust and MediaPipe SDK/runtime alignment checks passed. Existing Chrome
exercised real components in synthetic desktop/narrow fixtures: native keyboard
activation, disabled controls, persisted toggle, reduced motion, draft retention
and cleanup. Real-package nonce tests passed; production CSP was not weakened.
Production geometry/CSP checks passed in Chrome at 50%, 95%, 100%, 125% and 200%
zoom, including persisted toggles. The optional WebKit leg could not launch because
its Playwright browser binary is not installed. Logs are ignored under
`.git/upstream-44/`.

The authoritative cross-platform results are in [PR #2's checks](https://github.com/fmckie/gg-framework/pull/2/checks):
all six Linux/macOS/Windows framework/app jobs must pass, including the blocking
Windows MSI build-and-launch smoke. Full native screen-reader, live-provider,
host-application/audio/screen and signed/notarized
installation checks remain unverified. No camera, inference model downloads, real
sessions or credentials were used; internal mode is enabled only in disposable tests.

**Not release-ready:** the dependency audit reports **115** full-graph alerts
(60 high, 46 moderate, 9 low), versus 114 (61/43/10); **20** production alerts
(10 high, 8 moderate, 2 low), versus 18 (9/7/2). New adm-zip advisories
**GHSA-xcpc-8h2w-3j85** and **GHSA-vwc7-r8mq-g2x9** arrive through Transformers 4 /
ONNX's binary installer; that hook was not run locally. Existing Electron/Matey,
LangChain/Boss and sharp/libheif findings remain. Attachment processing reaches
the decoder covered by [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
Dependency remediation requires separate scope approval; this import is not a
comprehensive security review or a clean-audit claim.

**2026-09-18 update:** root `pnpm.overrides` now pin `undici@7` ≥7.29, `sharp`
≥0.35.4 and `adm-zip` ≥0.6.1, clearing every production alert on a `@kleio/*` path
(prod 21 → 3, remaining three are Matey-only). Triage and accepted-risk list:
[`docs/dependency-audit-2026-09-18.md`](docs/dependency-audit-2026-09-18.md).

## Original imported baseline

- Upstream repository: `https://github.com/KenKaiii/gg-framework`
- Upstream commit: `cde19e9e41b419546d0c167f12a3d616bdd30ccc`
- Upstream package version: `4.10.1`
- Import date: `2026-07-17`
- Immutable baseline tag: `upstream/4.10.1-cde19e9`
- Unshipped mechanical baseline: `4.10.1-kleio.0`
- Direct-rename baseline commit: `ef12845`
- Mechanical baseline tag: `kleio/mechanical-4.10.1-kleio.0`
- First publish candidate: `4.10.1-kleio.1`

The immutable upstream tag remains untouched. Commit `ef12845` directly renamed the
five package names, workspace dependency specifiers, and TypeScript import specifiers
from the upstream scope to `@kleio/*`. Its successful build and test suite establish
behavioral parity, while artifact comparisons must normalize exactly the five mappings
below and reject every other runtime delta. Version `.0` records that unshipped
mechanical baseline; it must not be published.

## Package map

| Upstream              | Downstream       |
| --------------------- | ---------------- |
| `@kenkaiiii/gg-ai`    | `@kleio/ai`      |
| `@kenkaiiii/gg-agent` | `@kleio/agent`   |
| `@kenkaiiii/gg-core`  | `@kleio/core`    |
| `@kenkaiiii/ggcoder`  | `@kleio/coder`   |
| `@kenkaiiii/gg-boss`  | `@kleio/manager` |

Runtime imports and workspace dependencies use the downstream `@kleio/*` names.
The upstream names above remain only as immutable provenance for the imported
baseline.

## License and attribution

The upstream MIT license and copyright notices are retained unchanged in
[`LICENSE`](LICENSE). Downstream changes remain distributed under that license.

## Sync policy

The `upstream` Git remote is read-only. Upstream updates are imported from an
exact reviewed commit on `sync/upstream-<version>` branches. Every import records
its merge base here and in [`fork-provenance.json`](fork-provenance.json), then
passes the artifact, clean-consumer, full test, and Atlas live gates before a
fixed downstream release is promoted.
