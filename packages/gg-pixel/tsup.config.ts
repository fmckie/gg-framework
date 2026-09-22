import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    // No entry cleans: tsup builds the six configs concurrently, and a clean here
    // ran inside the index DTS worker at buildStart, deleting every dist/*.d.ts
    // after sibling entries (deno/browser/workers) had already emitted theirs.
    // The build script empties dist once before tsup starts instead.
    clean: false,
    sourcemap: true,
    // Inject `import.meta.url` shim into CJS output — local-sqlite.ts and
    // install.ts both call `createRequire(import.meta.url)`, which is empty
    // under CJS without this.
    shims: true,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    sourcemap: true,
    clean: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: ["src/browser.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    platform: "browser",
    target: "es2020",
  },
  {
    entry: { "browser.iife": "src/browser.iife.ts" },
    format: ["iife"],
    globalName: "GGPixel",
    sourcemap: true,
    clean: false,
    platform: "browser",
    target: "es2020",
    minify: true,
  },
  {
    entry: ["src/deno.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    platform: "neutral",
    target: "es2022",
  },
  {
    entry: ["src/workers.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    platform: "neutral",
    target: "es2022",
  },
]);
