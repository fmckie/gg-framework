# Upstream provenance

This repository is the Kleio-owned downstream fork of
[`KenKaiii/gg-framework`](https://github.com/KenKaiii/gg-framework).

## Imported baseline

- Upstream repository: `https://github.com/KenKaiii/gg-framework`
- Upstream commit: `cde19e9e41b419546d0c167f12a3d616bdd30ccc`
- Upstream package version: `4.10.1`
- Import date: `2026-07-17`
- Immutable baseline tag: `upstream/4.10.1-cde19e9`
- First downstream release: `4.10.1-kleio.0`

The baseline tag points at the untouched upstream commit. The first downstream
commit changes only ownership, package/repository/version metadata, dependency
aliases, release infrastructure, and provenance documentation. Runtime source
behavior remains the upstream `4.10.1` behavior until the separately reviewed
Kleio rebrand release.

## Package map

| Upstream | Downstream |
| --- | --- |
| `@kenkaiiii/gg-ai` | `@kleio/ai` |
| `@kenkaiiii/gg-agent` | `@kleio/agent` |
| `@kenkaiiii/gg-core` | `@kleio/core` |
| `@kenkaiiii/ggcoder` | `@kleio/coder` |
| `@kenkaiiii/gg-boss` | `@kleio/manager` |

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
