// Kleio's release version for the __KLEIO_VERSION__ define that src/version.ts
// reads: gg-app/package.json "version" (the app and the host ship together).
// Shared by tsup.config.ts (built into dist) and vitest.config.ts (tests).
// Throws, failing the build or the test run, unless the version is x.y.z.
import { readFileSync } from "node:fs";

function kleioVersion(): string {
  const file = new URL("../../gg-app/package.json", import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const version =
    typeof parsed === "object" && parsed !== null && "version" in parsed
      ? parsed.version
      : undefined;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `gg-app/package.json "version" must be x.y.z for the host build; got ${JSON.stringify(version)}`,
    );
  }
  return version;
}

/** The define entry for tsup / vitest. */
export function kleioVersionDefine(): Record<string, string> {
  return { __KLEIO_VERSION__: JSON.stringify(kleioVersion()) };
}
