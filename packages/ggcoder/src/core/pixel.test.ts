import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAllErrors, fetchPixelEntries } from "./pixel.js";

let home: string;
const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ggcoder-pixel-"));
  logSpy.mockClear();
  errorSpy.mockClear();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function output(): string {
  return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
}

function fakeFetch(perProject: Record<string, unknown[]>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const match = /\/api\/projects\/([^/]+)\/errors/.exec(url);
    const id = match?.[1] ?? "";
    // The new server requires Authorization. The fake mirrors that contract
    // so tests verify the client actually sends it.
    const headers = new Headers(init?.headers ?? {});
    if (!headers.get("authorization")?.startsWith("Bearer ")) {
      return new Response("missing auth", { status: 401 });
    }
    const errors = perProject[id] ?? [];
    return new Response(JSON.stringify({ errors }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// Builds a projects.json mapping with `secret` populated — what `pixel install`
// produces in the new world. Tests that want to exercise the legacy
// no-secret path can construct mappings without it explicitly.
function project(name: string, path: string): { name: string; path: string; secret: string } {
  return { name, path, secret: `sk_live_${name}_test` };
}

describe("listAllErrors", () => {
  it("prints a friendly message when there are no projects", async () => {
    await listAllErrors({ homeDir: home, fetchFn: fakeFetch({}) });
    expect(output()).toContain("No projects registered");
  });

  it("prints a friendly message when projects.json is empty", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(join(home, ".gg", "projects.json"), "{}");
    await listAllErrors({ homeDir: home, fetchFn: fakeFetch({}) });
    expect(output()).toContain("No projects registered");
  });

  it("renders a clean state when a project has zero errors", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({ proj_a: project("alpha", "/p/alpha") }),
    );
    await listAllErrors({ homeDir: home, fetchFn: fakeFetch({ proj_a: [] }) });
    const out = output();
    expect(out).toContain("alpha");
    expect(out).toContain("no open errors");
    expect(out).toContain("All clean");
  });

  it("groups errors per project and aggregates a summary", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({
        proj_a: project("alpha", "/p/alpha"),
        proj_b: project("beta", "/p/beta"),
      }),
    );

    const aErrors = [
      {
        id: "err_1",
        fingerprint: "fp1",
        status: "open",
        type: "TypeError",
        message: "Cannot read foo",
        stack: JSON.stringify([{ file: "/p/alpha/src/x.ts", line: 12, in_app: true }]),
        occurrences: 5,
        recurrence_count: 0,
        last_seen_at: Date.now(),
        branch: null,
      },
      {
        id: "err_2",
        fingerprint: "fp2",
        status: "awaiting_review",
        type: "RangeError",
        message: "Bad index",
        stack: JSON.stringify([{ file: "/p/alpha/src/y.ts", line: 7, in_app: true }]),
        occurrences: 1,
        recurrence_count: 0,
        last_seen_at: Date.now(),
        branch: "fix/pixel-err_2",
      },
    ];
    const bErrors = [
      {
        id: "err_3",
        fingerprint: "fp3",
        status: "merged",
        type: "Error",
        message: "old, should be hidden",
        stack: null,
        occurrences: 1,
        recurrence_count: 0,
        last_seen_at: Date.now(),
        branch: null,
      },
    ];

    await listAllErrors({
      homeDir: home,
      fetchFn: fakeFetch({ proj_a: aErrors, proj_b: bErrors }),
    });

    const out = output();
    expect(out).toContain("alpha");
    expect(out).toContain("TypeError");
    expect(out).toContain("Cannot read foo");
    expect(out).toContain("/p/alpha/src/x.ts:12");
    expect(out).toContain("RangeError");
    expect(out).toContain("fix/pixel-err_2");
    expect(out).toContain("beta");
    expect(out).toContain("no open errors");
    expect(out).not.toContain("old, should be hidden");
    expect(out).toContain("1 open");
    expect(out).toContain("1 awaiting review");
  });

  it("prints a per-project error when fetch fails for that project", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({ proj_a: project("alpha", "/p/alpha") }),
    );
    const failingFetch: typeof fetch = (async () =>
      new Response("oops", { status: 500 })) as unknown as typeof fetch;
    await listAllErrors({ homeDir: home, fetchFn: failingFetch });
    expect(output()).toContain("alpha: failed to fetch (500)");
  });

  it("fetchPixelEntries returns structured data with hasProjects=false when no map exists", async () => {
    const result = await fetchPixelEntries({ homeDir: home, fetchFn: fakeFetch({}) });
    expect(result).toEqual({ entries: [], unreachable: [], unmanaged: [], hasProjects: false });
  });

  it("fetchPixelEntries flattens errors from all projects, grouped and sorted", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({
        proj_a: project("alpha", "/p/a"),
        proj_b: project("beta", "/p/b"),
      }),
    );
    const aErrors = [
      {
        id: "err_1",
        fingerprint: "fp1",
        status: "open",
        type: "TypeError",
        message: "x",
        stack: JSON.stringify([{ file: "/p/a/x.ts", line: 1, in_app: true }]),
        occurrences: 5,
        recurrence_count: 0,
        last_seen_at: 0,
        branch: null,
      },
      {
        id: "err_merged",
        fingerprint: "fp_merged",
        status: "merged",
        type: "Error",
        message: "old",
        stack: null,
        occurrences: 1,
        recurrence_count: 0,
        last_seen_at: 0,
        branch: null,
      },
    ];
    const bErrors = [
      {
        id: "err_2",
        fingerprint: "fp2",
        status: "failed",
        type: "RangeError",
        message: "y",
        stack: JSON.stringify([{ file: "/p/b/y.ts", line: 2, in_app: true }]),
        occurrences: 1,
        recurrence_count: 0,
        last_seen_at: 0,
        branch: null,
      },
    ];

    const result = await fetchPixelEntries({
      homeDir: home,
      fetchFn: fakeFetch({ proj_a: aErrors, proj_b: bErrors }),
    });

    expect(result.hasProjects).toBe(true);
    expect(result.entries).toHaveLength(2); // merged is filtered out
    expect(result.entries.map((e) => e.projectName)).toEqual(["alpha", "beta"]);
    expect(result.entries[0]?.location).toBe("x.ts:1");
  });

  it("fetchPixelEntries records unreachable projects on fetch failure", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({ proj_a: project("alpha", "/p/a") }),
    );
    const failingFetch: typeof fetch = (async () =>
      new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const result = await fetchPixelEntries({ homeDir: home, fetchFn: failingFetch });
    expect(result.entries).toHaveLength(0);
    expect(result.unreachable).toEqual(["alpha"]);
    expect(result.hasProjects).toBe(true);
  });

  it("prefers the topmost in_app frame for the location line", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({ proj_a: project("alpha", "/p") }),
    );
    const errors = [
      {
        id: "err_1",
        fingerprint: "fp",
        status: "open",
        type: "Error",
        message: "x",
        stack: JSON.stringify([
          { file: "/p/node_modules/lib/index.js", line: 999, in_app: false },
          { file: "/p/src/me.ts", line: 11, in_app: true },
        ]),
        occurrences: 1,
        recurrence_count: 0,
        last_seen_at: Date.now(),
        branch: null,
      },
    ];
    await listAllErrors({ homeDir: home, fetchFn: fakeFetch({ proj_a: errors }) });
    const out = output();
    expect(out).toContain("/p/src/me.ts:11");
    expect(out).not.toContain(":999");
  });

  it("sends Authorization: Bearer <secret> on every list request", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({
        proj_a: { name: "alpha", path: "/p/a", secret: "sk_live_secret_a" },
      }),
    );
    const seen: Array<{ url: string; auth: string | null }> = [];
    const recorder: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        auth: new Headers(init?.headers ?? {}).get("authorization"),
      });
      return new Response(JSON.stringify({ errors: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await fetchPixelEntries({ homeDir: home, fetchFn: recorder });
    expect(result.unreachable).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.auth).toBe("Bearer sk_live_secret_a");
  });

  it("flags projects without a stored secret as unmanaged and skips them", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({
        proj_legacy: { name: "legacy-app", path: "/p/legacy" }, // no secret
        proj_new: project("new-app", "/p/new"),
      }),
    );
    const result = await fetchPixelEntries({
      homeDir: home,
      fetchFn: fakeFetch({ proj_new: [] }),
    });
    expect(result.unmanaged).toEqual(["legacy-app"]);
    expect(result.hasProjects).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it("listAllErrors prints a re-install hint for projects with no secret", async () => {
    mkdirSync(join(home, ".gg"), { recursive: true });
    writeFileSync(
      join(home, ".gg", "projects.json"),
      JSON.stringify({
        proj_legacy: { name: "legacy-app", path: "/p/legacy" },
      }),
    );
    await listAllErrors({ homeDir: home, fetchFn: fakeFetch({}) });
    const out = output();
    expect(out).toContain("legacy-app");
    expect(out).toContain("missing bearer secret");
    expect(out).toContain("kleio-coder pixel install");
  });
});
