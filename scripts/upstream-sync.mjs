#!/usr/bin/env node

// Offline only. A ready candidate is structurally checked, not approved to merge.
// Usage: node scripts/upstream-sync.mjs --repo PATH --base SHA --upstream SHA
//        --imported SHA [--keep-candidate]
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CANDIDATE_RECIPE = "parent-time-v1";
const SHA = /^[0-9a-f]{40}$/;
const MAX_JSON = 1024 * 1024;
const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_PACK = 128 * 1024 * 1024;
const MAX_PATHS = 100_000;
const POLICY_URL = new URL("./upstream-sync-policy.json", import.meta.url);
const REGULAR_MODES = new Set(["100644", "100755"]);
const decoder = new TextDecoder("utf-8", { fatal: true });

class Blocked extends Error {
  constructor(rule, path, detail) {
    super(detail ?? rule);
    this.failure = { rule, ...(path ? { path } : {}), ...(detail ? { detail } : {}) };
  }
}

function validPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 4096 &&
    !/[\p{Cc}\\:]/u.test(path) &&
    path
      .split("/")
      .every((part) => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git")
  );
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loadPolicy() {
  const bytes = readFileSync(POLICY_URL);
  if (bytes.length > MAX_JSON) throw new Blocked("invalid-policy");
  const policy = JSON.parse(decoder.decode(bytes));
  if (
    policy.schemaVersion !== 1 ||
    !object(policy.canonicalPackages) ||
    Object.keys(policy.canonicalPackages).length !== 5 ||
    !Object.entries(policy.canonicalPackages).every(
      ([path, name]) => validPath(path) && typeof name === "string" && name.startsWith("@kleio/"),
    ) ||
    ![
      "protectedFiles",
      "protectedDirectories",
      "protectedBasenames",
      "requiredFiles",
      "retainedProjects",
      "manifestFields",
    ].every(
      (field) =>
        Array.isArray(policy[field]) && policy[field].length > 0 && policy[field].every(validPath),
    )
  )
    throw new Blocked("invalid-policy");
  return policy;
}

export function validateInputs(options) {
  if (
    !object(options) ||
    typeof options.repo !== "string" ||
    options.repo.length === 0 ||
    options.repo.length > 4096
  ) {
    throw new Blocked("invalid-local-path");
  }
  for (const key of ["base", "upstream", "imported"]) {
    if (typeof options[key] !== "string" || !SHA.test(options[key]))
      throw new Blocked("invalid-commit-id", undefined, key);
  }
  if (options.keepCandidate !== undefined && typeof options.keepCandidate !== "boolean")
    throw new Blocked("invalid-keep-option");
  if (
    Object.keys(options).some(
      (key) => !["repo", "base", "upstream", "imported", "keepCandidate"].includes(key),
    )
  )
    throw new Blocked("unknown-option");
}

// Empty files, never os.devNull: on Windows devNull is the device path \\.\nul,
// which git cannot access() when told to open it as a config/attributes file.
function isolatedFile(home, name) {
  const file = join(home, name);
  if (!existsSync(file)) writeFileSync(file, "");
  return file;
}

function isolatedEnvironment(home) {
  return {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: isolatedFile(home, ".isolated-gitconfig"),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_AUTHOR_NAME: "Local candidate",
    GIT_AUTHOR_EMAIL: "local-candidate@localhost",
    GIT_COMMITTER_NAME: "Local candidate",
    GIT_COMMITTER_EMAIL: "local-candidate@localhost",
  };
}

function git(context, args, { input, sourceObjects, maxBuffer = MAX_OUTPUT, statuses = [0] } = {}) {
  const result = spawnSync(
    "git",
    [
      "--no-pager",
      "--no-replace-objects",
      "-c",
      "core.hooksPath=" + join(context.home, "disabled-hooks"),
      "-c",
      "core.attributesFile=" + isolatedFile(context.home, ".isolated-gitattributes"),
      "-c",
      "protocol.allow=never",
      "-c",
      "credential.helper=",
      "-c",
      "gc.auto=0",
      "-c",
      "maintenance.auto=false",
      "--git-dir=" + context.gitDir,
      ...args,
    ],
    {
      cwd: context.home,
      env: { ...context.env, ...(sourceObjects ? { GIT_OBJECT_DIRECTORY: sourceObjects } : {}) },
      input,
      maxBuffer,
      timeout: 120_000,
      killSignal: "SIGKILL",
      windowsHide: true,
    },
  );
  if (result.error || !statuses.includes(result.status)) {
    // Do not echo Git stderr: it can contain arbitrary repository content/paths.
    throw new Blocked(
      "git-operation-failed",
      undefined,
      `${args[0]} failed or exceeded its resource limit`,
    );
  }
  return { status: result.status, output: result.stdout };
}

function text(result) {
  return decoder.decode(result.output);
}

function sourceObjectDirectory(repo) {
  // Linked worktrees, alternate stores and shallow/partial histories need a
  // separately reviewed transfer strategy. Never read their config or helpers.
  const root = realpathSync(resolve(repo));
  const dotGit = join(root, ".git");
  const directory = existsSync(dotGit) ? dotGit : root;
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    throw new Blocked("unsupported-repository-layout");
  if (!lstatSync(join(directory, "HEAD")).isFile())
    throw new Blocked("unsupported-repository-layout");
  for (const file of [
    "shallow",
    "commondir",
    "info/grafts",
    "objects/info/alternates",
    "objects/info/http-alternates",
  ]) {
    if (existsSync(join(directory, file))) throw new Blocked("unsupported-object-storage", file);
  }
  const objects = join(directory, "objects");
  let count = 0;
  function inspect(path) {
    const stat = lstatSync(path);
    if (++count > MAX_PATHS || stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Blocked("unsupported-object-storage");
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) inspect(join(path, entry));
    } else if (path.endsWith(".promisor")) {
      throw new Blocked("unsupported-partial-history");
    }
  }
  inspect(objects);
  return objects;
}

function loadLocalSnapshots(context, options) {
  const sourceObjects = sourceObjectDirectory(options.repo);
  for (const sha of [options.base, options.upstream, options.imported]) {
    if (text(git(context, ["cat-file", "-t", sha], { sourceObjects })).trim() !== "commit")
      throw new Blocked("not-a-commit");
  }
  // Only the isolated repository's config/refs are visible to Git. Export
  // reachable objects as a bounded pack, then index independently: no fetch,
  // alternates, hardlinks, shared writable objects, or source repository writes.
  const pack = git(context, ["pack-objects", "--stdout", "--revs"], {
    sourceObjects,
    input: `${options.base}\n${options.upstream}\n${options.imported}\n`,
    maxBuffer: MAX_PACK,
  }).output;
  git(context, ["index-pack", "--stdin", "--strict"], { input: pack });
}

function ancestor(context, older, newer) {
  return (
    git(context, ["merge-base", "--is-ancestor", older, newer], { statuses: [0, 1] }).status === 0
  );
}

function checkAncestry(context, options) {
  if (!ancestor(context, options.imported, options.base))
    throw new Blocked("import-not-in-fork-history");
  if (!ancestor(context, options.imported, options.upstream))
    throw new Blocked("rewritten-or-unrelated-upstream-history");
}

function readTree(context, revision) {
  const records = text(git(context, ["ls-tree", "-r", "-z", "--full-tree", revision]))
    .split("\0")
    .filter(Boolean);
  if (records.length > MAX_PATHS) throw new Blocked("tree-too-large");
  const tree = new Map();
  const portablePaths = new Map();
  for (const record of records) {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40})\t([\s\S]+)$/u.exec(record);
    if (!match || !validPath(match[4]) || tree.has(match[4]))
      throw new Blocked("unsupported-tree-entry");
    const parts = match[4].split("/");
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join("/");
      const portable = prefix.normalize("NFC").toLowerCase();
      if (portablePaths.has(portable) && portablePaths.get(portable) !== prefix)
        throw new Blocked("nonportable-path-collision", match[4]);
      portablePaths.set(portable, prefix);
    }
    tree.set(match[4], { mode: match[1], type: match[2], oid: match[3] });
  }
  return tree;
}

function readJson(context, tree, path) {
  const entry = tree.get(path);
  if (!entry || !REGULAR_MODES.has(entry.mode) || entry.type !== "blob")
    throw new Blocked("required-regular-file", path);
  const size = Number(text(git(context, ["cat-file", "-s", entry.oid])).trim());
  if (!Number.isSafeInteger(size) || size > MAX_JSON) throw new Blocked("manifest-too-large", path);
  let data;
  try {
    data = JSON.parse(text(git(context, ["cat-file", "blob", entry.oid], { maxBuffer: MAX_JSON })));
  } catch {
    throw new Blocked("invalid-json", path);
  }
  if (!object(data)) throw new Blocked("invalid-manifest-shape", path);
  for (const field of [
    "scripts",
    "pnpm",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    if (data[field] !== undefined && !object(data[field]))
      throw new Blocked("invalid-manifest-shape", path, field);
  }
  for (const field of [
    "scripts",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    if (data[field] && Object.values(data[field]).some((value) => typeof value !== "string"))
      throw new Blocked("invalid-manifest-shape", path, field);
  }
  return data;
}

function equal(left, right) {
  // Preserve ordering too: conditional export key order can change resolution.
  return JSON.stringify(left) === JSON.stringify(right);
}

function protectedPath(policy, path) {
  const lower = path.toLowerCase();
  return (
    policy.protectedFiles.some((file) => file.toLowerCase() === lower) ||
    policy.protectedBasenames.some((file) => file.toLowerCase() === basename(lower)) ||
    policy.protectedDirectories.some(
      (directory) =>
        lower === directory.toLowerCase() || lower.startsWith(directory.toLowerCase() + "/"),
    ) ||
    /(?:^|\/)(?:licen[cs]e|copying|notice)(?:$|[._-])/iu.test(path)
  );
}

function validateCandidate(context, base, candidate, policy, options) {
  const failures = [];
  function fail(rule, path, detail) {
    if (failures.length < 100) failures.push({ rule, path, ...(detail ? { detail } : {}) });
  }
  const required = new Set([...policy.requiredFiles, ...Object.keys(policy.canonicalPackages)]);
  for (const path of required) {
    if (!REGULAR_MODES.has(base.get(path)?.mode)) fail("invalid-trusted-baseline", path);
    if (!REGULAR_MODES.has(candidate.get(path)?.mode)) fail("required-regular-file", path);
  }
  for (const path of new Set([...base.keys(), ...candidate.keys()])) {
    if (protectedPath(policy, path)) {
      if (
        (base.has(path) && !REGULAR_MODES.has(base.get(path).mode)) ||
        (candidate.has(path) && !REGULAR_MODES.has(candidate.get(path).mode))
      )
        fail("protected-file-type", path);
      if (!equal(base.get(path), candidate.get(path))) fail("protected-change", path);
    }
  }
  const provenance = readJson(context, base, "fork-provenance.json");
  if (provenance.upstream?.lastImportedCommit !== options.imported)
    fail("imported-id-does-not-match-provenance", "fork-provenance.json");
  if (
    provenance.downstream?.scope !== "@kleio" ||
    typeof provenance.downstream?.currentFixedVersion !== "string"
  )
    fail("invalid-downstream-provenance", "fork-provenance.json");
  const retained = provenance.localIntegration?.preservedProjects;
  if (
    !Array.isArray(retained) ||
    !retained.every(validPath) ||
    !policy.retainedProjects.every((path) => retained.includes(path))
  ) {
    fail("invalid-retained-project-baseline", "fork-provenance.json");
  } else {
    for (const directory of new Set([...policy.retainedProjects, ...retained])) {
      if (![...base.keys()].some((path) => path.startsWith(directory + "/")))
        fail("missing-retained-baseline", directory);
      if (![...candidate.keys()].some((path) => path.startsWith(directory + "/")))
        fail("removed-retained-project", directory);
      for (const [path, entry] of base) {
        if (
          path.startsWith(directory + "/") &&
          /(?:^|\/)(?:package\.json|Cargo\.toml|pyproject\.toml|go\.mod|Gemfile|Package\.swift|[^/]+\.gemspec)$/u.test(
            path,
          ) &&
          candidate.get(path)?.mode !== entry.mode
        )
          fail("removed-or-retyped-project-manifest", path);
      }
    }
  }
  const names = Object.values(policy.canonicalPackages);
  const mappings = provenance.packages;
  if (
    !object(mappings) ||
    Object.values(mappings).length !== names.length ||
    !names.every((name) => Object.values(mappings).includes(name))
  )
    fail("invalid-package-mapping", "fork-provenance.json");
  for (const path of new Set([...base.keys(), ...candidate.keys()])) {
    if (basename(path) !== "package.json") continue;
    if (
      !base.has(path) ||
      !candidate.has(path) ||
      base.get(path).mode !== candidate.get(path).mode
    ) {
      fail("manifest-added-removed-or-retyped", path);
      continue;
    }
    const before = readJson(context, base, path);
    const after = readJson(context, candidate, path);
    for (const field of policy.manifestFields)
      if (!equal(before[field], after[field])) fail("manifest-field-changed", path, field);
    if (policy.canonicalPackages[path]) {
      if (
        before.name !== policy.canonicalPackages[path] ||
        before.version !== provenance.downstream?.currentFixedVersion ||
        !object(before.exports) ||
        !object(before.repository)
      )
        fail("invalid-canonical-baseline", path);
      for (const field of ["version", "repository"])
        if (!equal(before[field], after[field])) fail("canonical-identity-changed", path, field);
    }
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const name of [...names, ...Object.keys(object(mappings) ? mappings : {})]) {
        if (!equal(before[field]?.[name], after[field]?.[name]))
          fail("internal-package-reference-changed", path, field);
      }
    }
  }
  return failures;
}

export function prepareCandidate(options) {
  let home;
  let keep = false;
  const report = {
    status: "blocked",
    verification: "structural-only",
    recipe: CANDIDATE_RECIPE,
    failures: [],
  };
  try {
    validateInputs(options);
    report.inputs = { base: options.base, upstream: options.upstream, imported: options.imported };
    const policy = loadPolicy();
    home = mkdtempSync(join(tmpdir(), "kleio-candidate-"));
    const context = { home, gitDir: join(home, "candidate.git"), env: isolatedEnvironment(home) };
    mkdirSync(join(home, "empty-template"));
    git(context, [
      "init",
      "--bare",
      "--object-format=sha1",
      "--template=" + join(home, "empty-template"),
      context.gitDir,
    ]);
    // Explicit inspection also retains failed/no-op preparations as data only.
    keep = options.keepCandidate === true;
    if (keep) report.candidateDirectory = context.gitDir;
    loadLocalSnapshots(context, options);
    checkAncestry(context, options);
    const base = readTree(context, options.base);
    report.failures = validateCandidate(context, base, base, policy, options);
    if (report.failures.length) return report;
    if (ancestor(context, options.upstream, options.base)) {
      report.status = "no-change";
      return report;
    }
    const merge = git(
      context,
      ["merge-tree", "--write-tree", "--name-only", "-z", options.base, options.upstream],
      { statuses: [0, 1] },
    );
    const fields = text(merge).split("\0");
    const tree = fields.shift();
    if (!SHA.test(tree)) throw new Blocked("invalid-merge-output");
    report.tree = tree;
    if (merge.status === 1) {
      report.status = "conflict";
      report.failures = [];
      for (const path of fields) {
        if (!path) break;
        if (!validPath(path)) throw new Blocked("unsupported-conflict-path");
        if (report.failures.length < 100) report.failures.push({ rule: "merge-conflict", path });
      }
      if (!report.failures.length) report.failures.push({ rule: "merge-conflict" });
      return report;
    }
    report.failures = validateCandidate(context, base, readTree(context, tree), policy, options);
    if (report.failures.length) return report;
    // Commit identity must not depend on the runner's wall clock or timezone.
    const timestamps = [options.base, options.upstream].map((parent) => {
      const value = text(git(context, ["show", "-s", "--format=%ct", parent])).trim();
      const seconds = Number(value);
      if (!/^\d{1,12}$/.test(value) || !Number.isSafeInteger(seconds) || seconds > 253402300799)
        throw new Blocked("invalid-parent-timestamp");
      return seconds;
    });
    const date = `@${Math.max(...timestamps)} +0000`;
    context.env.GIT_AUTHOR_DATE = date;
    context.env.GIT_COMMITTER_DATE = date;
    report.commitDate = date;
    const commit = text(
      git(context, ["commit-tree", tree, "-p", options.base, "-p", options.upstream], {
        input: "Local-only upstream candidate; structural checks only\n",
      }),
    ).trim();
    if (!SHA.test(commit)) throw new Blocked("invalid-candidate-id");
    git(context, ["update-ref", "refs/heads/candidate", commit]);
    report.status = "candidate-ready";
    report.candidate = commit;
    return report;
  } catch (error) {
    report.status = "blocked";
    report.failures = [
      error instanceof Blocked
        ? error.failure
        : {
            rule: "local-preparation-failed",
            detail: "Invalid or inaccessible local data; no candidate approved",
          },
    ];
    return report;
  } finally {
    // This path is allocated internally; no caller-controlled output/cleanup path.
    // Retry: on Windows a just-exited git can still hold pack/index handles for a
    // moment, and a single rmSync would silently leave the directory behind.
    if (home && !keep)
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export function formatReport(report) {
  return JSON.stringify(report, null, 2) + "\n";
}

function cli(argv) {
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write(
      "Usage: node scripts/upstream-sync.mjs --repo PATH --base SHA --upstream SHA --imported SHA [--keep-candidate]\nOffline structural checks only. No dependencies or candidate code are executed.\n",
    );
    return;
  }
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const key = {
      "--repo": "repo",
      "--base": "base",
      "--upstream": "upstream",
      "--imported": "imported",
      "--keep-candidate": "keepCandidate",
    }[flag];
    if (!key || Object.hasOwn(options, key)) throw new Blocked("unknown-or-duplicate-option");
    options[key] = key === "keepCandidate" ? true : argv[++i];
  }
  const report = prepareCandidate(options);
  process.stdout.write(formatReport(report));
  process.exitCode = ["candidate-ready", "no-change"].includes(report.status) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli(process.argv.slice(2));
  } catch {
    process.stdout.write(
      formatReport({ status: "blocked", failures: [{ rule: "invalid-cli-arguments" }] }),
    );
    process.exitCode = 1;
  }
}
