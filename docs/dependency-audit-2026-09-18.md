# Dependency audit triage — 2026-09-18

**Base:** `main` @ `79735cb4` (engine 5.60.2 import + verification gates).
**Tool:** `pnpm audit` / `pnpm audit --prod`, pnpm 10.5.2.
**Scope rule:** "prod" = reachable from a published `@kleio/*` package or `gg-app`
at runtime. Matey (private Electron tool) and dev tooling are not shipped to users.

## Before → after

| Graph | Before | After |
|---|---|---|
| `--prod` | 21 (11 high · 8 moderate · 2 low) | **3** (2 high · 1 moderate) |
| full | 116 (61 high · 46 moderate · 9 low) | 96 (50 high · 39 moderate · 7 low) |

## Fixed (root `pnpm.overrides`)

| Package | Was | Now | Alerts cleared | Path into Kleio |
|---|---|---|---|---|
| `undici` (7.x only) | 7.25.0 | 7.29.1 | 12 (GHSA-vmh5-mc38-953g, -vxpw-j846-p89q, -hm92-r4w5-c3mj, -4cwx-7wf7-3272, -p88m-4jfj-68fv, -pr7r-676h-xcf6, -8xcm-r25x-g524, -m8rv-5g2x-5cg5, -jr45-8vmc-qm54, -v3r7-h72x-cjcm, -g8m3-5g58-fq7m, -35p6-xmwp-9g52) | `@kleio/ai` → `openai@7` peer; `gg-app` |
| `sharp` | 0.34.5 / 0.35.3 | 0.35.4 | 2 (GHSA-f88m-g3jw-g9cj libvips, GHSA-rgj7-g3m4-5g8c libheif) | `@kleio/core`, `@kleio/coder`, `@kleio/manager`, `gg-editor` (attachment decoding) |
| `adm-zip` | 0.5.18 | 0.6.1 | 3 (GHSA-xcpc-8h2w-3j85, GHSA-7q85-xj36-vmfc, GHSA-vwc7-r8mq-g2x9) | `@huggingface/transformers` → `onnxruntime-node` installer |

The `undici` override is range-scoped (`undici@>=7 <8`) so the `undici@5/6` copies
under `gg-pixel-server`'s old Vite/miniflare toolchain are untouched (dev-only,
see below). Upstream `KenKaiii/gg-framework` main (5.60.8) carries none of these
overrides; keep them across syncs.

## Accepted — prod graph, not Kleio-shipped

| Package | Alerts | Why accepted |
|---|---|---|
| `electron@42.2.0` | GHSA-r4w5-6pfg-jxp5 | Matey only. Matey is a private workspace tool, never published. Bump Electron when Matey is next touched. |
| `extract-zip@2.0.1` | GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3 | Matey only, via `@electron/get`. No patched release exists (`<0.0.0`). |

## Accepted — dev-only (96 remaining full-graph alerts)

All reachable only through build/test tooling, never at runtime:

- `vite`, `vitest`, `@vitest/mocker`, `esbuild`, `postcss`, `browserslist`,
  `baseline-browser-mapping`, `@babel/core` — test/build pipeline.
- `@xmldom/xmldom`, `app-builder-lib`, `builder-util-runtime`, `form-data`,
  `nanoid`, `tmp`, `brace-expansion`, `js-yaml` — Matey Electron packaging chain
  and root tooling.
- `undici@5.29.0` / `6.25.0` — `gg-pixel-server` dev deps (miniflare, old Vite).

These are refreshed opportunistically when the corresponding tool is bumped;
they do not block a release.

## Verification

After the overrides: `pnpm install`, `pnpm check` (exit 0), `pnpm test` (exit 0),
`pnpm audit:identity` (1888 files (the new doc included), 0 unclassified).

One pre-existing test-isolation flake surfaced while re-running the suite and was
fixed alongside: `ggcoder/src/tools/bash.test.ts` built `ProcessManager()` with the
default `bgDir` (the real `~/.gg/bg`), which raced the isolation assertion in
`process-manager-dev-server-repro.test.ts` under parallel workers. Managers in
that file now log under the per-test fake home. Not related to the overrides.

## Re-triage triggers

- Any new `--prod` alert on a `@kleio/*` path.
- An upstream sync that changes `openai`, `sharp`, `@huggingface/transformers` or
  `onnxruntime-node` ranges (the overrides may then be redundant — remove, don't stack).
