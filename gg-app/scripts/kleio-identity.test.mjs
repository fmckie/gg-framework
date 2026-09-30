// Kleio Desktop must never collide with GG Coder on the same Mac: its own app
// name and bundle id (so installing one can't replace the other, and macOS keeps
// their permissions and storage apart), its own icons, and no reads or writes of
// ~/.gg (GG Coder's and the ggcoder CLI's state). An upstream sync that quietly
// restores any of these fails here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));

function rustFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? rustFiles(p) : p.endsWith(".rs") ? [p] : [];
  });
}

describe("Kleio Desktop identity", () => {
  it("is Kleio, not GG Coder", () => {
    expect(conf.productName).toBe("Kleio");
    expect(conf.identifier).toBe("com.kleio.app");
    expect(conf.identifier).not.toBe("com.ggcoder.app");
  });

  it("uses only Kleio's icons", () => {
    for (const icon of conf.bundle.icon) expect(icon).toMatch(/^icons\/kleio\//);
  });

  it("never touches ~/.gg", () => {
    for (const file of rustFiles(join(root, "src-tauri/src"))) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/\.join\("\.gg"\)/);
    }
  });

  it("updates only from the fork, never Ken's releases", () => {
    const endpoints = conf.plugins?.updater?.endpoints ?? [];
    for (const url of endpoints) expect(url).toContain("github.com/fmckie/");
  });
});
