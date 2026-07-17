import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "../config.js";

interface PackageManifest {
  bin?: Record<string, string>;
}

const manifest = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
) as PackageManifest;

describe("Coder CLI bins", () => {
  it("maps preferred and legacy commands to the same entry point", () => {
    expect(manifest.bin).toEqual({
      "kleio-coder": "./dist/cli.js",
      ggcoder: "./dist/cli.js",
    });
  });

  it("retains the public legacy APP_NAME value", () => {
    expect(APP_NAME).toBe("ggcoder");
  });
});
