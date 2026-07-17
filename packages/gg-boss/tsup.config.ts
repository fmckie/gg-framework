import { defineConfig } from "tsup";

/**
 * gg-boss CLI is bundled into a single ESM file with every dependency
 * inlined. This is deliberate — the alternative is shipping a published
 * package.json with `dependencies: { @kleio/coder, ... }`, which then
 * pulls @modelcontextprotocol/sdk → express-rate-limit → ip-address@10.1.0
 * into the user's node_modules. ip-address 10.1.0 has an open advisory
 * (GHSA-v2v4-37r5-5v8g, XSS in Address6 HTML methods) that the upstream
 * express-rate-limit pin blocks us from satisfying — `npm audit` complains
 * loudly even though the vulnerable code path is unreachable in a TUI.
 *
 * Bundling means the published `dependencies` field is empty, so a fresh
 * `npm i -g @kleio/manager` ends up with zero transitive deps and a
 * clean audit. Users never see panic-inducing warnings on install.
 *
 * Reachability requirements (already satisfied):
 *  - ggcoder/utils/image.ts uses dynamic `await import("sharp")` so sharp
 *    isn't pulled in at module init for paths gg-boss touches (boss UI
 *    doesn't actually call shrinkToFit).
 *  - external[] below carves out native binaries that gg-boss will never
 *    actually load at runtime, so esbuild leaves them as bare requires.
 *
 * Tradeoffs:
 *  - dist/cli.js grows from ~7KB to ~5–8 MB. It's a one-time install, not
 *    a hot path; size is fine.
 *  - Sourcemaps preserved so stack traces stay useful.
 */
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  // ESM output. Some transitive deps use top-level await (ink, yoga-layout)
  // which CJS output can't represent, and others use dynamic require()
  // (cross-spawn → child_process) which by default throws under ESM. The
  // `banner` below patches createRequire into module scope so dynamic
  // requires resolve via Node's real require resolver instead of esbuild's
  // throwing stub.
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  // tsup externalises whatever's in package.json `dependencies` /
  // `peerDependencies`. We moved every runtime dep to `devDependencies`,
  // so by default tsup will INLINE all of them — that's the whole point.
  external: [
    // Native modules that gg-boss never reaches at runtime, but which exist
    // somewhere in the transitive ggcoder import graph. Marking them external
    // means esbuild leaves the `import` calls as `require` strings; if the
    // dead-code path ever did fire it'd error clearly rather than ship broken
    // bytecode. None of these will ever be invoked by gg-boss's flow.
    "sharp",
    "@huggingface/transformers",
    "onnxruntime-node",
    "better-sqlite3",
    "ogg-opus-decoder",
    // Optional Ink integration; only loaded when DEV=true (devtools panel).
    "react-devtools-core",
  ],
  sourcemap: true,
  clean: true,
  shims: true, // injects __dirname / import.meta.url for both ESM + CJS interop
  // Polyfill `require` in ESM-bundled CJS code. Without this, esbuild's
  // ESM-of-CJS conversion emits a stub that throws "Dynamic require of 'x'
  // is not supported" the moment any bundled CJS module calls require()
  // with a non-static argument (e.g. cross-spawn's runtime
  // require("child_process")). Backing it with createRequire(import.meta.url)
  // lets Node resolve the path through its normal require resolver.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  // src/cli.ts starts with a shebang that bumps --max-old-space-size and
  // exposes GC. tsup detects and preserves shebangs from source files, so
  // we don't add another one.
  //
  // env -S is required to pass flags through /usr/bin/env to node — supported
  // on macOS 10.13+ (FreeBSD-derived) and Linux coreutils 8.30+. Both ship in
  // every platform we target.
});
