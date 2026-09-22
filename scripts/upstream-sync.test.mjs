import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareCandidate } from "./upstream-sync.mjs";

const SCRIPT = fileURLToPath(new URL("./upstream-sync.mjs", import.meta.url));
const POLICY = JSON.parse(readFileSync(new URL("./upstream-sync-policy.json", import.meta.url)));
const VERSION = "5.60.2-kleio.1";
const CORE = "packages/gg-core/package.json";
const json = (data) => JSON.stringify(data, null, 2) + "\n";
const file = (content, mode = "100644") => ({ content, mode });

function environment(home) {
  // Never os.devNull as a config path: on Windows it is \\.\nul, unreadable by git.
  const gitconfig = join(home, ".isolated-gitconfig");
  if (!existsSync(gitconfig)) writeFileSync(gitconfig, "");
  return {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@localhost",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@localhost",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
}

function runGit(repo, env, args, input) {
  const result = spawnSync("git", ["--git-dir=" + repo, ...args], {
    env,
    input,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// Snapshot bytes, modes, refs, indexes, config and objects without invoking Git.
// This also works when the fixture deliberately has hostile local Git config.
function snapshot(root) {
  const result = new Map();
  function visit(path, relative) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      result.set(relative, [stat.mode, readlinkSync(path)]);
    } else if (stat.isDirectory()) {
      result.set(relative, [stat.mode]);
      for (const name of readdirSync(path).sort()) visit(join(path, name), relative + "/" + name);
    } else {
      result.set(relative, [
        stat.mode,
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      ]);
    }
  }
  visit(root, "");
  return result;
}

function fixture(t) {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "kleio-sync-test-")));
  const repo = join(home, "source.git");
  const env = environment(home);
  const kept = [];
  t.after(() => {
    // Retry: on Windows a just-exited git can briefly keep pack handles open and
    // a single forced rmSync would silently leave the tree behind.
    const options = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
    for (const candidate of kept) rmSync(dirname(candidate), options);
    rmSync(home, options);
  });
  mkdirSync(join(home, "empty-template"));
  runGit(repo, env, ["init", "--bare", "--template=" + join(home, "empty-template"), repo]);
  const blobCache = new Map();
  function commit(files, parents = []) {
    const indexEnv = { ...env, GIT_INDEX_FILE: join(home, "fixture-index") };
    runGit(repo, indexEnv, ["read-tree", "--empty"]);
    const entries = [];
    for (const [path, entry] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      let oid = blobCache.get(entry.content);
      if (!oid) {
        oid = runGit(repo, env, ["hash-object", "-w", "--stdin"], entry.content);
        blobCache.set(entry.content, oid);
      }
      entries.push(`${entry.mode} ${oid}\t${path}\0`);
    }
    runGit(repo, indexEnv, ["update-index", "-z", "--index-info"], entries.join(""));
    const tree = runGit(repo, indexEnv, ["write-tree"]);
    return runGit(
      repo,
      env,
      ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])],
      "fixture\n",
    );
  }
  const commonFiles = new Map();
  for (const path of POLICY.requiredFiles) commonFiles.set(path, file("preserved baseline\n"));
  for (const directory of POLICY.retainedProjects)
    commonFiles.set(directory + "/retained.txt", file("retained\n"));
  commonFiles.set(".github/workflows/ci.yml", file("name: Existing checks\n"));
  commonFiles.set(".gitattributes", file("shared.txt merge=sentinel\n"));
  commonFiles.set("LICENSE", file("Existing license\n"));
  commonFiles.set("shared.txt", file("original\n"));
  commonFiles.set(
    "package.json",
    file(
      json({
        name: "fixture",
        scripts: { build: "node build.mjs", check: "node check.mjs", test: "node --test" },
        pnpm: {
          onlyBuiltDependencies: ["esbuild"],
          overrides: { "fixture-dependency": "1.0.0" },
          patchedDependencies: { "fixture-dependency@1.0.0": "patches/fixture.patch" },
        },
      }),
    ),
  );
  for (const [path, name] of Object.entries(POLICY.canonicalPackages)) {
    commonFiles.set(
      path,
      file(
        json({
          name,
          version: VERSION,
          repository: { type: "git", url: "local-fixture", directory: dirname(path) },
          exports: { ".": { import: "./dist/index.js", default: "./dist/index.cjs" } },
          bin: { canonical: "./dist/cli.js", legacy: "./dist/cli.js" },
          scripts: { test: "node --test" },
          dependencies: { "@kleio/ai": "workspace:*" },
        }),
      ),
    );
  }
  commonFiles.set("packages/gg-pixel-go/go.mod", file("module fixture\n"));
  const provenance = {
    downstream: { scope: "@kleio", currentFixedVersion: VERSION },
    upstream: { lastImportedCommit: "0".repeat(40) },
    localIntegration: { preservedProjects: POLICY.retainedProjects },
    packages: Object.fromEntries(
      Object.values(POLICY.canonicalPackages).map((name) => ["legacy/" + name.slice(7), name]),
    ),
  };
  commonFiles.set("fork-provenance.json", file(json(provenance)));
  const common = commit(commonFiles);
  const importedFiles = new Map(commonFiles).set("imported.txt", file("previously imported\n"));
  const imported = commit(importedFiles, [common]);
  const baseFiles = new Map(importedFiles).set("kleio-only.txt", file("keep fork changes\n"));
  baseFiles.set(
    "fork-provenance.json",
    file(json({ ...provenance, upstream: { lastImportedCommit: imported } })),
  );
  const base = commit(baseFiles, [imported]);
  runGit(repo, env, ["update-ref", "refs/heads/main", base]);
  runGit(repo, env, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  const upstreamFiles = new Map(importedFiles).set("upstream.txt", file("new upstream work\n"));
  const upstream = commit(upstreamFiles, [imported]);
  function prepare(overrides = {}) {
    const before = snapshot(home);
    const result = prepareCandidate({ repo, base, upstream, imported, ...overrides });
    assert.deepEqual(
      snapshot(home),
      before,
      "source files, objects, refs, index and config must not change",
    );
    if (result.candidateDirectory) kept.push(result.candidateDirectory);
    return result;
  }
  return {
    home,
    repo,
    env,
    commit,
    common,
    commonFiles,
    imported,
    importedFiles,
    base,
    baseFiles,
    upstream,
    upstreamFiles,
    prepare,
  };
}

function assertBlocked(result, rule, path) {
  assert.equal(result.status, "blocked", json(result));
  assert.equal(result.candidate, undefined);
  assert.equal(result.candidateDirectory, undefined);
  assert.ok(
    result.failures.some((failure) => failure.rule === rule && (!path || failure.path === path)),
    json(result),
  );
}

function candidateWith(f, change) {
  const files = new Map(f.upstreamFiles);
  change(files);
  return f.commit(files, [f.imported]);
}

function changedManifest(files, path, mutate) {
  const data = JSON.parse(files.get(path).content);
  mutate(data);
  files.set(path, file(json(data)));
}

test("policy retains the independently recorded project identity and mandatory checks", () => {
  const root = new URL("../", import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL("fork-provenance.json", root)));
  assert.deepEqual(POLICY.retainedProjects, provenance.localIntegration.preservedProjects);
  assert.deepEqual(Object.values(POLICY.canonicalPackages).sort(), [
    "@kleio/agent",
    "@kleio/ai",
    "@kleio/coder",
    "@kleio/core",
    "@kleio/manager",
  ]);
  for (const [path, name] of Object.entries(POLICY.canonicalPackages)) {
    const manifest = JSON.parse(readFileSync(new URL(path, root)));
    assert.equal(manifest.name, name);
    assert.equal(path, manifest.repository.directory + "/package.json");
  }
  const required = [
    "pnpm-workspace.yaml",
    ".changeset/config.json",
    "fork-provenance.json",
    "scripts/identity-audit.mjs",
    "scripts/identity-allowlist.json",
    "scripts/verify-fixed-versions.mjs",
    "bench/size-gate.mjs",
    "bench/startup-gate.mjs",
    "bench/baseline/sizes.json",
    "packages/gg-core/src/product-profile.ts",
    "packages/gg-core/src/product-profile.test.ts",
    "packages/ggcoder/src/core/session-manager-first-prompt.test.ts",
  ];
  assert.ok(POLICY.requiredFiles.includes("package.json"));
  for (const path of required) {
    assert.ok(POLICY.requiredFiles.includes(path), `required baseline: ${path}`);
    assert.ok(POLICY.protectedFiles.includes(path), `protected check: ${path}`);
  }
  for (const path of [
    "scripts/upstream-sync.mjs",
    "scripts/upstream-sync-policy.json",
    "scripts/upstream-sync.test.mjs",
  ])
    assert.ok(POLICY.protectedFiles.includes(path), `protected checker: ${path}`);
  for (const path of [".github/workflows", "patches"])
    assert.ok(POLICY.protectedDirectories.includes(path), `protected directory: ${path}`);
  for (const path of [".gitignore", ".gitattributes", ".gitmodules", ".npmrc", ".pnpmfile.cjs"])
    assert.ok(POLICY.protectedBasenames.includes(path), `protected configuration: ${path}`);
  for (const field of [
    "name",
    "scripts",
    "pnpm",
    "packageManager",
    "engines",
    "workspaces",
    "overrides",
    "resolutions",
    "license",
    "type",
    "publishConfig",
    "files",
    "main",
    "module",
    "types",
    "bin",
    "exports",
  ])
    assert.ok(POLICY.manifestFields.includes(field), `protected manifest field: ${field}`);
});

test("clean merge preserves both histories and fork content in independent bare storage", (t) => {
  const f = fixture(t);
  const result = f.prepare({ keepCandidate: true });
  assert.equal(result.status, "candidate-ready", json(result));
  assert.equal(result.verification, "structural-only");
  assert.deepEqual(
    runGit(result.candidateDirectory, f.env, ["show", "-s", "--format=%P", result.candidate]).split(
      " ",
    ),
    [f.base, f.upstream],
  );
  assert.equal(
    runGit(result.candidateDirectory, f.env, ["show", result.candidate + ":kleio-only.txt"]),
    "keep fork changes",
  );
  assert.equal(
    runGit(result.candidateDirectory, f.env, ["show", result.candidate + ":upstream.txt"]),
    "new upstream work",
  );
  assert.equal(
    runGit(result.candidateDirectory, f.env, ["rev-parse", "refs/heads/candidate"]),
    result.candidate,
  );
  assert.equal(existsSync(join(result.candidateDirectory, "objects/info/alternates")), false);
  // Candidate objects are independent even when source storage is unavailable.
  const objects = join(f.repo, "objects");
  const parked = join(f.home, "parked-objects");
  const packed = join(result.candidateDirectory, "objects", "pack");
  for (const name of readdirSync(packed)) assert.equal(lstatSync(join(packed, name)).nlink, 1);
  renameSync(objects, parked);
  try {
    assert.equal(
      runGit(result.candidateDirectory, f.env, ["fsck", "--full", "--no-reflogs"]).includes(
        "missing",
      ),
      false,
    );
  } finally {
    renameSync(parked, objects);
  }
});

test("repeat runs produce the same decision/tree and default runs clean their temporary directory", (t) => {
  const f = fixture(t);
  // Give this test its own tmpdir so the leak check only sees candidates it
  // created: the other script suites run in parallel and prepare candidates too.
  const scratch = join(f.home, "scratch-tmp");
  mkdirSync(scratch);
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  for (const key of Object.keys(saved)) process.env[key] = scratch;
  t.after(() => {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  assert.equal(realpathSync.native(tmpdir()), scratch, "test-owned tmpdir in effect");
  const first = f.prepare();
  const second = f.prepare();
  assert.equal(first.status, "candidate-ready", json(first));
  assert.equal(first.tree, second.tree);
  assert.equal(first.candidate, second.candidate);
  assert.equal(first.recipe, "parent-time-v1");
  assert.equal(first.candidateDirectory, undefined);
  assert.deepEqual(
    readdirSync(scratch).filter((name) => name.startsWith("kleio-candidate-")),
    [],
    "default runs leave no candidate directory behind",
  );
});

test("independent repositories, caller clocks and timezones reproduce exact commit identity", (t) => {
  const first = fixture(t);
  const second = fixture(t);
  assert.notEqual(first.repo, second.repo);
  const expected = first.prepare({ keepCandidate: true });
  assert.equal(expected.status, "candidate-ready", json(expected));
  for (const [timezone, clock] of [
    ["Pacific/Honolulu", "2001-01-01T00:00:00Z"],
    ["Asia/Tokyo", "2040-01-01T00:00:00Z"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--repo",
        second.repo,
        "--base",
        second.base,
        "--upstream",
        second.upstream,
        "--imported",
        second.imported,
      ],
      {
        env: { ...second.env, TZ: timezone, GIT_AUTHOR_DATE: clock, GIT_COMMITTER_DATE: clock },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).candidate, expected.candidate);
  }
  const metadata = runGit(expected.candidateDirectory, first.env, [
    "show",
    "-s",
    "--format=%at %ct %ai %ci",
    expected.candidate,
  ]);
  assert.equal(
    metadata,
    "1767225600 1767225600 2026-01-01 00:00:00 +0000 2026-01-01 00:00:00 +0000",
  );
  // Equal trees alone must never be accepted as candidate identity.
  for (const [parents, message, date] of [
    [
      [first.upstream, first.base],
      "Local-only upstream candidate; structural checks only\n",
      expected.commitDate,
    ],
    [[first.base], "Local-only upstream candidate; structural checks only\n", expected.commitDate],
    [[first.base, first.upstream], "different message\n", expected.commitDate],
    [
      [first.base, first.upstream],
      "Local-only upstream candidate; structural checks only\n",
      "@1767225601 +0000",
    ],
  ]) {
    const changed = runGit(
      expected.candidateDirectory,
      {
        ...first.env,
        GIT_AUTHOR_NAME: "Local candidate",
        GIT_COMMITTER_NAME: "Local candidate",
        GIT_AUTHOR_EMAIL: "local-candidate@localhost",
        GIT_COMMITTER_EMAIL: "local-candidate@localhost",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
      ["commit-tree", expected.tree, ...parents.flatMap((parent) => ["-p", parent])],
      message,
    );
    assert.notEqual(changed, expected.candidate);
    assert.equal(
      runGit(expected.candidateDirectory, first.env, ["rev-parse", changed + "^{tree}"]),
      expected.tree,
    );
  }
});

test("candidate date uses the later parent committer time", (t) => {
  const f = fixture(t);
  const later = runGit(
    f.repo,
    { ...f.env, GIT_COMMITTER_DATE: "@1893456000 +0530" },
    ["commit-tree", runGit(f.repo, f.env, ["rev-parse", f.upstream + "^{tree}"]), "-p", f.upstream],
    "later\n",
  );
  const result = f.prepare({ upstream: later });
  assert.equal(result.status, "candidate-ready", json(result));
  assert.equal(result.commitDate, "@1893456000 +0000");
});

test("no-op creates no candidate refs and keeps inspection storage only when requested", (t) => {
  const f = fixture(t);
  const automatic = f.prepare({ upstream: f.imported });
  assert.equal(automatic.status, "no-change", json(automatic));
  assert.equal(automatic.candidate, undefined);
  assert.equal(automatic.candidateDirectory, undefined);
  const inspected = f.prepare({ upstream: f.imported, keepCandidate: true });
  assert.equal(inspected.status, "no-change", json(inspected));
  assert.equal(inspected.candidate, undefined);
  assert.ok(inspected.candidateDirectory);
  assert.equal(
    runGit(inspected.candidateDirectory, f.env, ["for-each-ref", "refs/heads/candidate"]),
    "",
  );
});

test("text conflicts stop without consulting source merge drivers or hooks", (t) => {
  const f = fixture(t);
  const base = f.commit(new Map(f.baseFiles).set("shared.txt", file("fork change\n")), [f.base]);
  const upstream = candidateWith(f, (files) => files.set("shared.txt", file("upstream change\n")));
  const marker = join(f.home, "hook-was-run");
  const hooks = join(f.home, "hooks");
  mkdirSync(hooks);
  for (const hook of ["pre-merge-commit", "reference-transaction", "post-checkout"]) {
    const path = join(hooks, hook);
    writeFileSync(path, `#!/bin/sh\nprintf invoked > '${marker}'\n`);
    chmodSync(path, 0o755);
  }
  writeFileSync(
    join(f.repo, "config"),
    `[core]\n bare = true\n hooksPath = ${hooks}\n[merge "sentinel"]\n driver = exit 99\n[include]\n path = ${join(f.home, "missing-config")}\n`,
  );
  const result = f.prepare({ base, upstream, keepCandidate: true });
  assert.equal(result.status, "conflict", json(result));
  assert.deepEqual(result.failures, [{ rule: "merge-conflict", path: "shared.txt" }]);
  assert.equal(result.candidate, undefined);
  assert.ok(result.candidateDirectory);
  assert.match(result.tree, /^[0-9a-f]{40}$/);
  assert.equal(runGit(result.candidateDirectory, f.env, ["cat-file", "-t", result.tree]), "tree");
  assert.equal(
    runGit(result.candidateDirectory, f.env, ["for-each-ref", "refs/heads/candidate"]),
    "",
  );
  const automatic = f.prepare({ base, upstream });
  assert.equal(automatic.status, "conflict", json(automatic));
  assert.equal(automatic.tree, result.tree);
  assert.equal(automatic.candidate, undefined);
  assert.equal(automatic.candidateDirectory, undefined);
  assert.equal(existsSync(marker), false);
  const clean = f.prepare();
  assert.equal(clean.status, "candidate-ready", json(clean));
  assert.equal(existsSync(marker), false);
});

test("ambiguous manifest conflicts are not automatically resolved", (t) => {
  const f = fixture(t);
  const baseFiles = new Map(f.baseFiles);
  changedManifest(baseFiles, CORE, (data) => {
    data.description = "fork wording";
  });
  const base = f.commit(baseFiles, [f.base]);
  const upstream = candidateWith(f, (files) =>
    changedManifest(files, CORE, (data) => {
      data.description = "upstream wording";
    }),
  );
  const result = f.prepare({ base, upstream });
  assert.equal(result.status, "conflict", json(result));
  assert.ok(result.failures.some((failure) => failure.path === CORE));
});

test("protected edits, additions, removals, renames and modes block otherwise clean merges", async (t) => {
  const f = fixture(t);
  const path = ".github/workflows/ci.yml";
  const scenarios = {
    edit: (files) => files.set(path, file("name: Replacement\n")),
    addition: (files) => files.set(".github/workflows/new.yml", file("name: New\n")),
    removal: (files) => files.delete(path),
    rename: (files) => {
      files.set("moved.yml", files.get(path));
      files.delete(path);
    },
    mode: (files) => files.set(path, file(files.get(path).content, "100755")),
    symlink: (files) => files.set(path, file("elsewhere.yml", "120000")),
    license: (files) => files.set("LICENSE", file("replacement license\n")),
    workspace: (files) => files.set("pnpm-workspace.yaml", file("packages: []\n")),
    auditor: (files) => files.set("scripts/identity-audit.mjs", file("// disabled\n")),
    allowlist: (files) => files.set("scripts/identity-allowlist.json", file("{}\n")),
    budget: (files) => files.set("bench/baseline/sizes.json", file("{}\n")),
    profile: (files) => files.set("packages/gg-core/src/product-profile.ts", file("// changed\n")),
    policyAddition: (files) => files.set("scripts/upstream-sync-policy.json", file("{}\n")),
    futureHelper: (files) => files.set("scripts/upstream-sync.mjs", file("// replacement\n")),
    nestedWorkflowDirectory: (files) =>
      files.set(".github/workflows/nested/ci.yml", file("name: New\n")),
    nestedAttributes: (files) => files.set("src/.gitattributes", file("* merge=union\n")),
    nestedInstallPolicy: (files) =>
      files.set("packages/gg-core/.npmrc", file("ignore-scripts=false\n")),
  };
  for (const [name, change] of Object.entries(scenarios)) {
    await t.test(name, () =>
      assertBlocked(f.prepare({ upstream: candidateWith(f, change) }), "protected-change"),
    );
  }
});

test("blocked trees remain inspectable on request without creating candidate commits", (t) => {
  const f = fixture(t);
  const path = ".github/workflows/ci.yml";
  const upstream = candidateWith(f, (files) => files.set(path, file("name: Replacement\n")));
  const automatic = f.prepare({ upstream });
  assertBlocked(automatic, "protected-change", path);
  assert.match(automatic.tree, /^[0-9a-f]{40}$/);
  const inspected = f.prepare({ upstream, keepCandidate: true });
  assert.equal(inspected.status, "blocked", json(inspected));
  assert.deepEqual(inspected.failures, automatic.failures);
  assert.equal(inspected.candidate, undefined);
  assert.ok(inspected.candidateDirectory);
  assert.equal(inspected.tree, automatic.tree);
  assert.equal(
    runGit(inspected.candidateDirectory, f.env, ["show", inspected.tree + ":" + path]),
    "name: Replacement",
  );
  assert.equal(
    runGit(inspected.candidateDirectory, f.env, ["for-each-ref", "refs/heads/candidate"]),
    "",
  );
});

test("identity, commands, exports, internal dependencies and build policy are conservative", async (t) => {
  const f = fixture(t);
  const scenarios = {
    name: [
      CORE,
      (data) => {
        data.name = "replacement";
      },
      "manifest-field-changed",
    ],
    version: [
      CORE,
      (data) => {
        data.version = "99.0.0";
      },
      "canonical-identity-changed",
    ],
    repository: [
      CORE,
      (data) => {
        data.repository.url = "replacement";
      },
      "canonical-identity-changed",
    ],
    export: [
      CORE,
      (data) => {
        delete data.exports["."];
      },
      "manifest-field-changed",
    ],
    exportOrder: [
      CORE,
      (data) => {
        data.exports["."] = { default: "./dist/index.cjs", import: "./dist/index.js" };
      },
      "manifest-field-changed",
    ],
    command: [
      CORE,
      (data) => {
        delete data.bin.legacy;
      },
      "manifest-field-changed",
    ],
    script: [
      CORE,
      (data) => {
        data.scripts.test = "echo ignored";
      },
      "manifest-field-changed",
    ],
    internalDependency: [
      CORE,
      (data) => {
        data.dependencies["@kleio/ai"] = "*";
      },
      "internal-package-reference-changed",
    ],
    rootScript: [
      "package.json",
      (data) => {
        data.scripts.check = "echo ignored";
      },
      "manifest-field-changed",
    ],
    overrides: [
      "package.json",
      (data) => {
        data.pnpm.overrides["fixture-dependency"] = "*";
      },
      "manifest-field-changed",
    ],
    patches: [
      "package.json",
      (data) => {
        delete data.pnpm.patchedDependencies;
      },
      "manifest-field-changed",
    ],
    buildHooks: [
      "package.json",
      (data) => {
        data.pnpm.onlyBuiltDependencies.push("new-hook");
      },
      "manifest-field-changed",
    ],
  };
  for (const [name, [path, change, rule]] of Object.entries(scenarios)) {
    await t.test(name, () =>
      assertBlocked(
        f.prepare({ upstream: candidateWith(f, (files) => changedManifest(files, path, change)) }),
        rule,
        path,
      ),
    );
  }
});

test("retained projects, language manifests and existing package manifests cannot disappear", async (t) => {
  const f = fixture(t);
  await t.test("whole project", () => {
    const upstream = candidateWith(f, (files) => {
      for (const path of files.keys())
        if (path.startsWith("packages/gg-pixel-go/")) files.delete(path);
    });
    assertBlocked(f.prepare({ upstream }), "removed-retained-project", "packages/gg-pixel-go");
  });
  await t.test("language manifest", () =>
    assertBlocked(
      f.prepare({
        upstream: candidateWith(f, (files) => files.delete("packages/gg-pixel-go/go.mod")),
      }),
      "removed-or-retyped-project-manifest",
    ),
  );
  await t.test("package manifest", () =>
    assertBlocked(
      f.prepare({ upstream: candidateWith(f, (files) => files.delete(CORE)) }),
      "manifest-added-removed-or-retyped",
    ),
  );
  await t.test("new package requires review", () =>
    assertBlocked(
      f.prepare({
        upstream: candidateWith(f, (files) => files.set("new/package.json", file("{}\n"))),
      }),
      "manifest-added-removed-or-retyped",
    ),
  );
});

test("rewritten history is rejected despite sharing an older common ancestor", (t) => {
  const f = fixture(t);
  const rewritten = f.commit(
    new Map(f.commonFiles).set("rewritten.txt", file("different history\n")),
    [f.common],
  );
  assertBlocked(f.prepare({ upstream: rewritten }), "rewritten-or-unrelated-upstream-history");
  // Supplying an older checkpoint cannot bypass the pinned provenance identity.
  assertBlocked(
    f.prepare({ upstream: rewritten, imported: f.common }),
    "imported-id-does-not-match-provenance",
  );
});

test("unrelated, missing, non-commit and malformed revisions fail closed", async (t) => {
  const f = fixture(t);
  const unrelated = f.commit(f.upstreamFiles);
  await t.test("unrelated", () =>
    assertBlocked(f.prepare({ upstream: unrelated }), "rewritten-or-unrelated-upstream-history"),
  );
  await t.test("missing", () =>
    assertBlocked(f.prepare({ upstream: "f".repeat(40) }), "git-operation-failed"),
  );
  const blob = runGit(f.repo, f.env, ["hash-object", "-w", "--stdin"], "not a commit\n");
  await t.test("blob", () => assertBlocked(f.prepare({ upstream: blob }), "not-a-commit"));
  await t.test("same-mode non-blob graph is rejected during strict object import", () => {
    const malformedTree = runGit(
      f.repo,
      f.env,
      ["hash-object", "--literally", "-t", "tree", "-w", "--stdin"],
      Buffer.concat([Buffer.from("100644 go.mod\0"), Buffer.from(f.imported, "hex")]),
    );
    const malformedCommit = runGit(
      f.repo,
      f.env,
      ["commit-tree", malformedTree, "-p", f.imported],
      "invalid object graph fixture\n",
    );
    assertBlocked(f.prepare({ upstream: malformedCommit }), "git-operation-failed");
  });
  await t.test("revision expression", () =>
    assertBlocked(f.prepare({ upstream: "HEAD~1" }), "invalid-commit-id"),
  );
  await t.test("option injection", () =>
    assertBlocked(f.prepare({ base: "--help" }), "invalid-commit-id"),
  );
  await t.test("unknown output path", () =>
    assertBlocked(f.prepare({ output: f.home }), "unknown-option"),
  );
});

test("invalid, oversized and symlinked manifests block instead of being interpreted", async (t) => {
  const f = fixture(t);
  for (const [name, entry, rule] of [
    ["invalid JSON", file("{"), "invalid-json"],
    ["invalid object", file("[]"), "invalid-manifest-shape"],
    ["invalid scripts", file(json({ scripts: [] })), "invalid-manifest-shape"],
    ["oversized", file(" ".repeat(1024 * 1024 + 1)), "manifest-too-large"],
    ["symlink", file("somewhere", "120000"), "manifest-added-removed-or-retyped"],
  ]) {
    await t.test(name, () =>
      assertBlocked(
        f.prepare({ upstream: candidateWith(f, (files) => files.set(CORE, entry)) }),
        rule,
      ),
    );
  }
});

test("dirty worktree, staged changes and ambient Git overrides are neither used nor changed", (t) => {
  const f = fixture(t);
  const checkout = join(f.home, "checkout");
  mkdirSync(checkout);
  // A separate ordinary layout referencing fixture objects through an independent pack.
  const gitDir = join(checkout, ".git");
  mkdirSync(gitDir);
  runGit(gitDir, f.env, ["init", "--template=" + join(f.home, "empty-template"), checkout]);
  const packed = spawnSync(
    "git",
    ["--git-dir=" + f.repo, "pack-objects", "--stdout", "--all", "--reflog", "--revs"],
    { env: f.env, input: `${f.base}\n${f.upstream}\n`, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(packed.status, 0);
  runGit(gitDir, f.env, ["index-pack", "--stdin"], packed.stdout);
  runGit(gitDir, f.env, ["update-ref", "refs/heads/main", f.base]);
  runGit(gitDir, f.env, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  runGit(gitDir, f.env, ["read-tree", f.base]);
  writeFileSync(join(checkout, "uncommitted.txt"), "uncommitted secret sentinel\n");
  const stagedBlob = runGit(gitDir, f.env, ["hash-object", "-w", "--stdin"], "staged sentinel\n");
  runGit(gitDir, f.env, [
    "update-index",
    "--add",
    "--cacheinfo",
    `100644,${stagedBlob},staged.txt`,
  ]);
  const keys = {
    GIT_DIR: "/invalid/git-dir",
    GIT_OBJECT_DIRECTORY: "/invalid/objects",
    GIT_CONFIG_GLOBAL: "/invalid/config",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/invalid/hooks",
    GIT_ALTERNATE_OBJECT_DIRECTORIES: "/invalid/alternates",
  };
  const old = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, keys);
    const result = f.prepare({ repo: checkout, keepCandidate: true });
    assert.equal(result.status, "candidate-ready", json(result));
    const paths = runGit(result.candidateDirectory, f.env, [
      "ls-tree",
      "-r",
      "--name-only",
      result.tree,
    ]);
    assert.equal(paths.includes("uncommitted.txt"), false);
    assert.equal(paths.includes("staged.txt"), false);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("alternate, partial, shallow and linked storage is rejected without helpers", async (t) => {
  const f = fixture(t);
  for (const path of [
    "objects/info/alternates",
    "objects/info/http-alternates",
    "shallow",
    "commondir",
    "objects/pack/fixture.promisor",
  ]) {
    await t.test(path, () => {
      writeFileSync(join(f.repo, path), "not-followed\n");
      const result = f.prepare();
      assertBlocked(
        result,
        path.endsWith(".promisor") ? "unsupported-partial-history" : "unsupported-object-storage",
      );
      rmSync(join(f.repo, path));
    });
  }
  await t.test("linked worktree", () => {
    const root = join(f.home, "linked");
    mkdirSync(root);
    writeFileSync(join(root, ".git"), `gitdir: ${f.repo}\n`);
    assertBlocked(f.prepare({ repo: root }), "unsupported-repository-layout");
  });
  await t.test("symlinked objects", () => {
    const path = join(f.repo, "objects", "linked");
    symlinkSync(join(f.repo, "HEAD"), path);
    assertBlocked(f.prepare(), "unsupported-object-storage");
    rmSync(path);
  });
});

test("control characters and portable path collisions cannot bypass preservation", async (t) => {
  const f = fixture(t);
  for (const [path, rule] of [
    ["packages/gg-core/Package.json", "nonportable-path-collision"],
    ["PACKAGES", "nonportable-path-collision"],
    ["new\u0085file.txt", "unsupported-tree-entry"],
  ]) {
    await t.test(JSON.stringify(path), () => {
      const upstream = candidateWith(f, (files) => files.set(path, file("data\n")));
      assertBlocked(f.prepare({ upstream }), rule);
    });
  }
});

test("CLI emits JSON, correct exit codes and no import-time effects", (t) => {
  const f = fixture(t);
  const before = snapshot(f.home);
  const argv = [
    SCRIPT,
    "--repo",
    f.repo,
    "--base",
    f.base,
    "--upstream",
    f.upstream,
    "--imported",
    f.imported,
  ];
  const ready = spawnSync(process.execPath, argv, { env: f.env, encoding: "utf8" });
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(JSON.parse(ready.stdout).status, "candidate-ready");
  const blocked = spawnSync(process.execPath, [...argv, "--push"], {
    env: f.env,
    encoding: "utf8",
  });
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).status, "blocked");
  const imported = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(new URL("./upstream-sync.mjs", import.meta.url).href)})`,
    ],
    { env: f.env, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.deepEqual(snapshot(f.home), before);
});
