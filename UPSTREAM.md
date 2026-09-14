# Upstream provenance

This repository is the Kleio-owned downstream fork of
[`KenKaiii/gg-framework`](https://github.com/KenKaiii/gg-framework).

## Latest local integration

- Inspected upstream snapshot: `3a4eb7e83fe19eebc74aa539d5fa940822f8cdd1`
- Upstream engine version: **5.59.3**, imported locally on **2026-09-11**
- Original fork HEAD: `0c69b71e0804726c36b45ded9134d94643f64f7d`
- Integration branch: `sync/upstream-2026-09-11`; backup: `backup/pre-upstream-2026-09-11`
- State: pending normal merge, not committed, pushed, published, installed globally, or deployed

All five Kleio packages retain version **4.10.1-kleio.1**. Existing published
artifacts do **not** contain this integration. The original fork point and its
immutable baseline below remain unchanged. An upstream SHA in provenance is a
source-import record, not a claim of committed ancestry or completed verification.

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

Local verification records are kept in `.git/upstream-sync/` for this pending
merge. macOS workspace build/type/unit checks, lint/format, five-package version
and source/packed identity checks, CLI smoke, and upstream size/startup gates
passed. Pixel runtime-switch tests cover pending saves, run finalizers, checkpoint
isolation, write boundaries, and failed preparation. Available SDK checks and the
imported app's frontend, Rust, and disposable sidecar checks passed. Baseline
native ABI, stale CLI fixture, and symlink-expectation failures remain recorded
separately; none is a failing final workspace test. Original platform/live-gated
tests were not enabled or removed.

**Not release-ready:** the dependency audit reports 114 full-graph alerts,
including 18 production alerts (9 high, 7 moderate, 2 low). The installed image
decoder includes a libheif version covered by
[GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c); attachment
processing reaches that decoder. Dependency remediation requires separate scope
approval rather than silently changing the inspected upstream resolution set.
This source integration is not a comprehensive security review.

Windows/Linux CI, provider APIs, host-application/audio/screen integration, and
signed/notarized installation require separate execution; no live deployment
verification or publication approval is implied here.

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
