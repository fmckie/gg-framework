// Unit tests for stage-host.mjs: what goes into the Mac app's host/ folder,
// from a stand-in kleio-host build in a temp folder. Nothing here builds or
// touches the real src-tauri/host/.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { hostVersion, parseArgs, stageHost } from "./stage-host.mjs";

const srcTauri = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");
const temps = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A built kleio-host package and kleio-link-host, as the Mac build leaves them. */
function built({ capture = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "stage-host-test-"));
  temps.push(root);
  const hostDir = join(root, "kleio-host");
  mkdirSync(join(hostDir, "dist", "bin"), { recursive: true });
  mkdirSync(join(hostDir, "scripts"));
  for (const name of [
    "cli.js",
    "cli.js.map",
    "index.js",
    "index.js.map",
    "index.d.ts",
    "chunk-S7EAFFIW.js",
    "chunk-S7EAFFIW.js.map",
  ])
    writeFileSync(join(hostDir, "dist", name), `// ${name}\n`);
  if (capture) writeFileSync(join(hostDir, "dist", "bin", "kleio-capture"), "capture\n");
  writeFileSync(join(hostDir, "scripts", "install-mini.sh"), "#!/bin/sh\n");
  const linkBin = join(root, "kleio-link-host");
  writeFileSync(linkBin, "link\n");
  chmodSync(linkBin, 0o644);
  return { hostDir, linkBin, outDir: join(root, "app", "host") };
}

function files(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => statSync(join(dir, p)).isFile())
    .map((p) => relative(dir, join(dir, p)))
    .sort();
}

const VERSION = "2.2.0+3f10e6b3";

describe("stageHost", () => {
  it("stages the host's code, the capture helper, kleio-link-host and the installer", () => {
    const b = built();

    stageHost({ ...b, version: VERSION });

    expect(files(b.outDir)).toEqual([
      "VERSION",
      "bin/kleio-link-host",
      "dist/bin/kleio-capture",
      "dist/chunk-S7EAFFIW.js",
      "dist/cli.js",
      "dist/index.js",
      "install-mini.sh",
      "package.json",
    ]);
    expect(statSync(join(b.outDir, "bin", "kleio-link-host")).mode & 0o111).toBe(0o111);
    expect(statSync(join(b.outDir, "dist", "bin", "kleio-capture")).mode & 0o111).toBe(0o111);
    expect(JSON.parse(readFileSync(join(b.outDir, "package.json"), "utf8"))).toEqual({
      type: "module",
    });
    expect(readFileSync(join(b.outDir, "VERSION"), "utf8")).toBe(`${VERSION}\n`);
  });

  it("stages no source maps or type declarations", () => {
    const b = built();

    stageHost({ ...b, version: VERSION });

    expect(files(b.outDir).filter((f) => f.endsWith(".map") || f.endsWith(".d.ts"))).toEqual([]);
  });

  it("replaces an earlier staging, leaving nothing of it behind", () => {
    const b = built();
    mkdirSync(join(b.outDir, "dist"), { recursive: true });
    writeFileSync(join(b.outDir, "dist", "chunk-OLD.js"), "old\n");

    stageHost({ ...b, version: VERSION });

    expect(existsSync(join(b.outDir, "dist", "chunk-OLD.js"))).toBe(false);
    expect(existsSync(`${b.outDir}.partial`)).toBe(false);
  });

  it("fails without kleio-link-host, and leaves the earlier staging alone", () => {
    const b = built();
    stageHost({ ...b, version: VERSION });
    rmSync(b.linkBin);

    expect(() => stageHost({ ...b, version: "2.2.1+aaaaaaaa" })).toThrow(
      /missing .*kleio-link-host/,
    );
    expect(readFileSync(join(b.outDir, "VERSION"), "utf8")).toBe(`${VERSION}\n`);
  });

  it("needs --no-capture to leave the capture helper out", () => {
    const b = built({ capture: false });

    expect(() => stageHost({ ...b, version: VERSION })).toThrow(/kleio-capture.*--no-capture/);
    expect(existsSync(b.outDir)).toBe(false);

    stageHost({ ...b, version: VERSION, capture: false });
    expect(files(b.outDir)).not.toContain("dist/bin/kleio-capture");
    expect(files(b.outDir)).toContain("dist/cli.js");
  });
});

describe("hostVersion", () => {
  it("is the app version and the commit", () => {
    expect(hostVersion("2.2.0", "3f10e6b3")).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
  });

  it("refuses anything that isn't a plain version and a git hash", () => {
    expect(() => hostVersion("2.2", "3f10e6b3")).toThrow(/x\.y\.z/);
    expect(() => hostVersion("2.2.0-beta", "3f10e6b3")).toThrow(/x\.y\.z/);
    expect(() => hostVersion("2.2.0", "3F10E6B3")).toThrow(/git hash/);
    expect(() => hostVersion("2.2.0", "../x")).toThrow(/git hash/);
  });
});

describe("parseArgs", () => {
  it("reads --link-bin and --no-capture", () => {
    expect(parseArgs([])).toEqual({ linkBin: undefined, capture: true });
    expect(parseArgs(["--link-bin", "/tmp/kleio-link-host", "--no-capture"])).toEqual({
      linkBin: "/tmp/kleio-link-host",
      capture: false,
    });
  });

  it("refuses an unknown option or a --link-bin with no path", () => {
    expect(() => parseArgs(["--capture"])).toThrow(/--capture/);
    expect(() => parseArgs(["--link-bin"])).toThrow(/--link-bin/);
    expect(() => parseArgs(["--link-bin", "--no-capture"])).toThrow(/--link-bin/);
  });
});

describe("the Mac app's resources", () => {
  it("are every app's resources plus host/", () => {
    const read = (name) => JSON.parse(readFileSync(join(srcTauri, name), "utf8"));
    const base = read("tauri.conf.json").bundle.resources;
    // A platform file replaces the whole list (JSON Merge Patch), so it repeats the base.
    expect(read("tauri.macos.conf.json").bundle.resources).toEqual([...base, "host/"]);
    expect(base).not.toContain("host/");
  });
});
