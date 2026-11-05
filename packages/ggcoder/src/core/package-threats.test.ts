import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkPackageInstall,
  clearPackageThreatCache,
  damerauLevenshtein,
  parseLockfile,
  parseLockfileAsync,
  parsePackageInstalls,
  type PackageCheckOptions,
} from "./package-threats.js";
import { emptyFeed } from "./threat-feed.js";

vi.mock("./logger.js", () => ({ log: vi.fn() }));

interface Queried {
  name: string;
  version?: string;
}

/** Fake npm/PyPI registry (latest = 2.0.0, old, popular) + OSV keyed by name@version. */
function fakeNet(malicious: Record<string, string[]>, queried: Queried[] = []): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.osv.dev")) {
      const body = JSON.parse(String(init?.body)) as {
        queries: Array<{ package: { name: string }; version?: string }>;
      };
      queried.push(...body.queries.map((q) => ({ name: q.package.name, version: q.version })));
      const results = body.queries.map((q) => ({
        vulns: (malicious[`${q.package.name}@${q.version}`] ?? []).map((id) => ({ id })),
      }));
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    if (url.includes("/downloads/")) return new Response(JSON.stringify({ downloads: 1e6 }));
    return new Response(
      JSON.stringify({
        "dist-tags": { latest: "2.0.0" },
        versions: { "1.0.0": { dist: {} }, "2.0.0": { dist: {} } },
        time: { "1.0.0": "2020-01-01T00:00:00Z", "2.0.0": "2021-01-01T00:00:00Z" },
        info: { version: "2.0.0" },
        releases: { "2.0.0": [{ upload_time_iso_8601: "2021-01-01T00:00:00Z" }] },
      }),
    );
  }) as unknown as typeof fetch;
}

const opts = (f: typeof fetch): PackageCheckOptions => ({
  fetch: f,
  env: {},
  feed: emptyFeed(),
  managerVersion: async () => "11.12.1",
});

describe("parsePackageInstalls", () => {
  it.each([
    ["npm install react", ["react"]],
    ["pnpm add -D @types/node@20 vitest", ["@types/node", "vitest"]],
    ["yarn add lodash", ["lodash"]],
    ["bun i zod", ["zod"]],
    ["npx create-vite my-app", ["create-vite"]],
    ["pip install requests==2.31 Flask[async]", ["requests", "flask"]],
    ["uv pip install numpy", ["numpy"]],
    ["pip install -r requirements.txt", []],
    ["npm install ./local-pkg", []],
    ["npm test", []],
  ])("%s", (command, names) => {
    expect(parsePackageInstalls(command).map((r) => r.name)).toEqual(names);
  });

  it("keeps the version spec", () => {
    expect(parsePackageInstalls("npm i chalk@5.3.0")[0]?.spec).toBe("5.3.0");
    expect(parsePackageInstalls("pip install requests==2.31")[0]?.spec).toBe("2.31");
  });
});

describe("parseLockfile", () => {
  it("reads package-lock and requirements pins", () => {
    const lock = JSON.stringify({ packages: { "": {}, "node_modules/ms": { version: "2.1.3" } } });
    expect(parseLockfile("package-lock.json", lock)).toEqual([{ name: "ms", version: "2.1.3" }]);
    expect(parseLockfile("requirements.txt", "a==1.0\nb>=2\n")).toEqual([
      { name: "a", version: "1.0" },
    ]);
  });
});

describe("parseLockfileAsync", () => {
  const lock = {
    name: "app",
    lockfileVersion: 3,
    packages: {
      "": { name: "app", dependencies: { a: "^1" } },
      "node_modules/a": { version: "1.2.3", dependencies: { b: "^2" } },
      "node_modules/a/node_modules/b": { version: "2.0.0" },
      "node_modules/alias": { name: "real-pkg", version: "3.0.0" },
      "node_modules/linked": { resolved: "../linked", link: true },
      "node_modules/@s/c": { version: "4.0.0", engines: { node: ">=18" } },
    },
    dependencies: { old: { version: "0.1.0", requires: { z: "1" } } },
  };
  const sorted = (xs: Array<{ name: string; version: string }>) =>
    xs.map((x) => `${x.name}@${x.version}`).sort();

  it.each([
    ["pretty", JSON.stringify(lock, null, 2)],
    ["CRLF + BOM", `\uFEFF${JSON.stringify(lock, null, 2).replace(/\n/g, "\r\n")}`],
    ["minified", JSON.stringify(lock)],
  ])("matches the sync parser for a %s package-lock", async (_label, text) => {
    const got = sorted(await parseLockfileAsync("package-lock.json", text));
    expect(got).toEqual(sorted(parseLockfile("package-lock.json", text)));
    expect(got).toEqual(["@s/c@4.0.0", "a@1.2.3", "b@2.0.0", "old@0.1.0", "real-pkg@3.0.0"]);
  });

  it("a truncated package-lock yields nothing; line formats match too", async () => {
    const text = JSON.stringify(lock, null, 2);
    expect(await parseLockfileAsync("package-lock.json", text.slice(0, 200))).toEqual([]);
    const yarn = '"a@^1":\n  version "1.2.3"\n\n"@s/c@^4", "@s/c@~4.0":\n  version "4.0.0"\n';
    expect(sorted(await parseLockfileAsync("yarn.lock", yarn))).toEqual(
      sorted(parseLockfile("yarn.lock", yarn)),
    );
  });
});

describe("parseLockfile BOM", () => {
  it("reads a package-lock saved with a BOM", () => {
    const text = `\uFEFF${JSON.stringify({ packages: { "node_modules/a": { version: "1.0.0" } } })}`;
    expect(parseLockfile("package-lock.json", text)).toEqual([{ name: "a", version: "1.0.0" }]);
  });
});

describe("damerauLevenshtein", () => {
  it("counts a transposition as one edit", () => {
    expect(damerauLevenshtein("raect", "react")).toBe(1);
    expect(damerauLevenshtein("react", "react")).toBe(0);
    expect(damerauLevenshtein("abc", "xyz")).toBe(3);
  });
});

describe("checkPackageInstall", () => {
  beforeEach(() => clearPackageThreatCache());

  it("queries OSV with the exact version, resolving latest when unnamed", async () => {
    const queried: Queried[] = [];
    await checkPackageInstall("npm i chalk debug@4.4.1", opts(fakeNet({}, queried)));
    // The pinned ref is queried concurrently with registry resolution.
    expect(queried).toEqual(
      expect.arrayContaining([
        { name: "chalk", version: "2.0.0" },
        { name: "debug", version: "4.4.1" },
      ]),
    );
    expect(queried).toHaveLength(2);
  });

  it("an old bad version does not block the clean one", async () => {
    const f = fakeNet({ "chalk@5.6.1": ["MAL-2025-46969"] });
    expect(await checkPackageInstall("npm i chalk@5.3.0", opts(f))).toEqual([]);
    const threats = await checkPackageInstall("npm i chalk@5.6.1", opts(f));
    expect(threats).toEqual([
      expect.objectContaining({ rule: "malicious-package", severity: "block" }),
    ]);
    expect(threats[0]?.detail).toContain("MAL-2025-46969");
  });

  it("keeps only MAL- ids", async () => {
    const threats = await checkPackageInstall(
      "npm i evil-pkg",
      opts(fakeNet({ "evil-pkg@2.0.0": ["MAL-2024-1", "GHSA-xxxx"] })),
    );
    expect(threats[0]?.detail).toContain("MAL-2024-1");
    expect(threats[0]?.detail).not.toContain("GHSA");
  });

  it("an established one-edit lookalike passes silently", async () => {
    expect(await checkPackageInstall("npm install raect", opts(fakeNet({})))).toEqual([]);
  });

  it("does not block popular packages", async () => {
    expect(await checkPackageInstall("npm install react", opts(fakeNet({})))).toEqual([]);
    expect(await checkPackageInstall("pip install requests", opts(fakeNet({})))).toEqual([]);
  });

  it("caches registry + OSV answers per process", async () => {
    const f = fakeNet({});
    await checkPackageInstall("npm i some-pkg", opts(f));
    const n = vi.mocked(f).mock.calls.length;
    await checkPackageInstall("npm i some-pkg", opts(f));
    expect(vi.mocked(f).mock.calls.length).toBe(n);
  });

  it("fails open when offline", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await checkPackageInstall("npm i some-pkg", opts(failing))).toEqual([]);
  });

  it("makes no request for non-install commands", async () => {
    const f = fakeNet({});
    expect(await checkPackageInstall("ls -la", opts(f))).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("a hung host costs the deadline once, then is skipped for a while", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      const hang = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
      const first = checkPackageInstall("npm i some-pkg", opts(hang));
      await vi.advanceTimersByTimeAsync(2_600);
      expect(await first).toEqual([]);
      const calls = vi.mocked(hang).mock.calls.length;
      expect(await checkPackageInstall("npm i other-pkg", opts(hang))).toEqual([]);
      // Nothing answered at all (offline / dead proxy): other hosts wait too.
      expect(await checkPackageInstall("pip install requests==2.31.0", opts(hang))).toEqual([]);
      expect(vi.mocked(hang).mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a 404 lookalike from a private registry is not called a typosquat", async () => {
    const notFound = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("api.osv.dev")
        ? new Response(JSON.stringify({ results: [] }))
        : new Response("{}", { status: 404 }),
    ) as unknown as typeof fetch;
    // Public npm only: a missing one-edit lookalike is blocked.
    const pub = await checkPackageInstall("npm install lodahs", opts(notFound));
    expect(pub[0]?.rule).toBe("typosquat");
    clearPackageThreatCache();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-npmrc-"));
    try {
      fs.writeFileSync(path.join(dir, ".npmrc"), "registry=https://npm.corp.example/\n");
      expect(
        await checkPackageInstall("npm install lodahs", { ...opts(notFound), cwd: dir }),
      ).toEqual([]);
      expect(
        await checkPackageInstall("pip install reqeusts", {
          ...opts(notFound),
          env: { PIP_INDEX_URL: "https://pypi.corp.example/simple" },
        }),
      ).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips local, git, URL and alias specs, and pipx runs are checked", async () => {
    const f = fakeNet({});
    for (const cmd of [
      "npm i ./local-dir",
      "npm i file:../x",
      "pnpm add foo@workspace:*",
      "npm i github:user/repo",
      "npm i https://example.com/x-1.0.0.tgz",
      "pip install -e .",
      "cargo add serde",
      "brew install wget",
    ]) {
      expect(await checkPackageInstall(cmd, opts(f))).toEqual([]);
    }
    expect(f).not.toHaveBeenCalled();
    expect(parsePackageInstalls("pipx run ruff --fix").map((r) => r.name)).toEqual(["ruff"]);
  });
});
