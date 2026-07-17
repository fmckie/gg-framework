import fs from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  bin?: Record<string, string>;
  types?: string;
  exports?: Record<string, string | Record<string, string>>;
}

const manifest = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as PackageManifest;

describe("Manager CLI bins", () => {
  it("maps preferred and legacy commands to the same entry point", () => {
    expect(manifest.bin).toEqual({
      "kleio-manager": "./dist/cli.js",
      ggboss: "./dist/cli.js",
    });
  });

  it("publishes preferred and legacy TypeScript APIs", () => {
    expect(manifest.types).toBe("./dist/index.d.ts");
    expect(manifest.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    });

    const declarations = fs.readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf-8");
    expect(declarations).toContain("GGBoss");
    expect(declarations).toContain("GGBossOptions");
    expect(declarations).toContain("KleioManager");
    expect(declarations).toContain("KleioManagerOptions");
    expect(declarations).not.toMatch(/from ["']@kleio\//);
  });
});
