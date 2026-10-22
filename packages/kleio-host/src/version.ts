// Kleio's release version (gg-app/package.json "version"), reported by
// GET /kleio/host. tsup.config.ts builds it into dist and vitest.config.ts
// defines it for tests, as __KLEIO_VERSION__; both fail unless it is x.y.z.
// Code run straight from src with neither (gg-app's tsx dev harnesses) has no
// define, so the typeof guard keeps that from throwing and reports "0.0.0".

declare const __KLEIO_VERSION__: string | undefined;

export const KLEIO_VERSION: string =
  typeof __KLEIO_VERSION__ === "string" ? __KLEIO_VERSION__ : "0.0.0";
