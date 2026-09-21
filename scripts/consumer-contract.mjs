#!/usr/bin/env node
// Trusted runner for public tarball contracts. Temporary HOME is not a filesystem sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { devNull, homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_PACKAGES, auditInstalledPackages } from "./identity-audit.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const LEGACY_CODER = "@kenkaiiii/ggcoder";
const VERSION = "4.10.1-kleio.1";
const MAX_BYTES = 128 * 1024 * 1024;
const json = (value) => JSON.stringify(value, null, 2) + "\n";
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function isolatedEnvironment(home) {
  mkdirSync(home, { recursive: true });
  // Two distinct empty files, not one shared null device: pnpm >= 10.3x refuses
  // to load the same path as both "user" and "global" config ("double-loading
  // config ... previously loaded as user") and exits before resolving anything.
  const userconfig = join(home, ".isolated-user.npmrc");
  const globalconfig = join(home, ".isolated-global.npmrc");
  for (const file of [userconfig, globalconfig]) if (!existsSync(file)) writeFileSync(file, "");
  return {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    CI: "true",
    NO_COLOR: "1",
    TERM: "dumb",
    npm_config_userconfig: userconfig,
    npm_config_globalconfig: globalconfig,
    npm_config_ignore_scripts: "true",
    npm_config_ignore_pnpmfile: "true",
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_manage_package_manager_versions: "false",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
  };
}

export function run(command, args, cwd, env, timeout = 120_000) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    killSignal: "SIGKILL",
  });
  if (result.error || result.status !== 0) {
    const error = new Error("consumer-subprocess-failed: " + basename(command) + " " + args[0]);
    // Bound diagnostics; these are logs, never interpreted as authorization.
    const diagnostic = result.stderr || result.stdout || result.error?.code || "";
    error.diagnostic =
      diagnostic.length > 4000
        ? diagnostic.slice(0, 2000) + "\n…\n" + diagnostic.slice(-1997)
        : diagnostic;
    error.message += ": " + error.diagnostic;
    throw error;
  }
  return result.stdout;
}

// Resolve the installed executable before entering any target directory. No shell/.cmd execution.
export function packageManager() {
  const candidates = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  for (const directory of candidates) {
    for (const name of process.platform === "win32" ? ["pnpm.exe", "pnpm.cjs", "pnpm"] : ["pnpm"]) {
      const path = join(directory, name);
      if (!existsSync(path) || !lstatSync(realpathSync(path)).isFile()) continue;
      const real = realpathSync(path);
      if (/\.(?:c?js|mjs)$/.test(real)) return { command: process.execPath, prefix: [real] };
      if (process.platform !== "win32" || real.endsWith(".exe"))
        return { command: real, prefix: [] };
    }
    // pnpm/action-setup's Windows npm installation provides this JS entry.
    for (const script of [
      join(directory, "node_modules", "pnpm", "bin", "pnpm.cjs"),
      join(directory, "..", "pnpm", "bin", "pnpm.cjs"),
    ]) {
      if (existsSync(script) && lstatSync(realpathSync(script)).isFile())
        return { command: process.execPath, prefix: [realpathSync(script)] };
    }
  }
  throw new Error("installed-pnpm-unavailable");
}

export function pnpm(tool, args, cwd, env, timeout = 120_000) {
  return run(
    tool.command,
    [
      ...tool.prefix,
      "--config.ignore-scripts=true",
      "--config.ignore-pnpmfile=true",
      "--config.manage-package-manager-versions=false",
      "--config.verify-deps-before-run=false",
      ...args,
    ],
    cwd,
    env,
    timeout,
  );
}

function contained(root, path) {
  const location = relative(realpathSync(root), realpathSync(path));
  assert.ok(location && !location.startsWith("..") && !isAbsolute(location), "path-outside-root");
  return realpathSync(path);
}

function safeRelative(path) {
  assert.ok(
    typeof path === "string" &&
      path.length < 4096 &&
      !/[\p{Cc}\\:]/u.test(path) &&
      path
        .split("/")
        .every((part) => part && part !== "." && part !== ".." && part !== "node_modules"),
    "invalid-package-path",
  );
}

export function workspaceClosure(root, tool, env) {
  const listed = JSON.parse(
    pnpm(tool, ["list", "--recursive", "--depth", "-1", "--json"], root, env),
  );
  assert.ok(Array.isArray(listed) && listed.length < 200, "invalid-workspace-list");
  const workspaces = new Map();
  for (const item of listed) {
    if (realpathSync(item.path) === realpathSync(root)) continue;
    const directory = contained(root, item.path);
    const manifestPath = join(directory, "package.json");
    assert.ok(
      lstatSync(manifestPath).isFile() &&
        !lstatSync(manifestPath).isSymbolicLink() &&
        lstatSync(manifestPath).size <= 256 * 1024,
      "invalid-workspace-manifest",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.ok(
      typeof manifest.name === "string" && !workspaces.has(manifest.name),
      "duplicate-workspace-name",
    );
    workspaces.set(manifest.name, { directory, manifest });
  }
  const closure = new Map();
  function visit(name) {
    if (closure.has(name)) return;
    const item = workspaces.get(name);
    assert.ok(item && !item.manifest.private, "missing-runtime-workspace: " + name);
    assert.ok(name.length <= 214, "runtime-package-name-limit");
    assert.match(
      name,
      /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/,
      "invalid-runtime-package-name",
    );
    closure.set(name, item);
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependency, spec] of Object.entries(item.manifest[field] ?? {})) {
        assert.equal(typeof spec, "string", "invalid-dependency-spec");
        if (spec.startsWith("workspace:")) {
          assert.ok(/^workspace:[*~^]$/.test(spec), "unsupported-workspace-reference");
          visit(dependency);
        } else if (workspaces.has(dependency)) {
          throw new Error("registry-workspace-substitute: " + dependency);
        } else {
          assert.ok(
            !/^(?:file:|link:|https?:|git|github:|\/|\.)/.test(spec),
            "non-registry-runtime-dependency",
          );
        }
      }
    }
  }
  for (const [directory, name] of Object.entries(CANONICAL_PACKAGES)) {
    visit(name);
    assert.equal(
      closure.get(name).directory,
      realpathSync(join(root, directory)),
      "canonical-workspace-path",
    );
    assert.equal(closure.get(name).manifest.version, VERSION, "canonical-version");
  }
  return closure;
}

export function packPackage(item, output, tool, env) {
  const result = JSON.parse(
    pnpm(tool, ["pack", "--json", "--pack-destination", output], item.directory, env),
  );
  assert.ok(result && !Array.isArray(result), "invalid-pack-json");
  assert.equal(result.name, item.manifest.name, "packed-name");
  assert.equal(result.version, item.manifest.version, "packed-version");
  assert.ok(typeof result.filename === "string", "missing-pack-filename");
  const tarball = isAbsolute(result.filename) ? result.filename : join(output, result.filename);
  contained(output, tarball);
  const stat = lstatSync(tarball);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_BYTES,
    "invalid-tarball-file",
  );
  assert.ok(
    Array.isArray(result.files) && result.files.length > 0 && result.files.length <= 100_000,
    "invalid-pack-files",
  );
  const paths = new Set();
  let size = 0;
  for (const entry of result.files) {
    safeRelative(entry.path);
    assert.ok(!paths.has(entry.path), "duplicate-pack-path");
    paths.add(entry.path);
    const source = join(item.directory, entry.path);
    contained(item.directory, source);
    const info = lstatSync(source);
    assert.ok(info.isFile() && !info.isSymbolicLink(), "nonregular-pack-source");
    // pnpm 10 lists paths, not npm's per-entry size metadata.
    size += info.size;
    assert.ok(size <= 512 * 1024 * 1024, "packed-size-limit");
  }
  assert.ok(paths.has("package.json"), "missing-packed-manifest");
  return {
    name: result.name,
    version: result.version,
    tarball,
    sha256: digest(readFileSync(tarball)),
    files: [...paths].sort(),
    exports: item.manifest.exports,
    bin: item.manifest.bin,
  };
}

export function verifyReceipt(receipt, closure) {
  assert.ok(
    Array.isArray(receipt) && receipt.length === closure.size,
    "incomplete-tarball-closure",
  );
  const seen = new Set();
  for (const item of receipt) {
    assert.ok(closure.has(item.name) && !seen.has(item.name), "unexpected-tarball-identity");
    seen.add(item.name);
    assert.equal(item.version, closure.get(item.name).manifest.version, "receipt-version");
    assert.ok(existsSync(item.tarball), "missing-local-tarball");
    const stat = lstatSync(item.tarball);
    assert.ok(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_BYTES,
      "invalid-local-tarball",
    );
    assert.equal(digest(readFileSync(item.tarball)), item.sha256, "tarball-hash-mismatch");
  }
}

// Copy-on-demand only: neither pnpm nor a writable link ever receives a source cache.
export function offlineCacheSeed(metadataSource, storeSource, home) {
  const metadata = join(home, "pnpm", "metadata-v1.3", "registry.npmjs.org");
  const store = join(home, "package-store", "v10");
  const sources = [metadataSource, storeSource].map((path) => {
    assert.ok(
      lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(),
      "invalid-cache-source",
    );
    const root = realpathSync(path);
    const overlap = relative(root, realpathSync(home));
    const reverse = relative(realpathSync(home), root);
    assert.ok(
      (overlap.startsWith("..") || isAbsolute(overlap)) &&
        (reverse.startsWith("..") || isAbsolute(reverse)),
      "overlapping-cache-source",
    );
    return root;
  });
  for (const path of [metadata, store]) {
    assert.ok(!existsSync(path), "seed-destination-already-exists");
    mkdirSync(path, { recursive: true });
  }
  const receipt = { metadata: [], packages: [], files: 0, bytes: 0 };
  const seeded = new Set();
  function missing(kind, name) {
    const error = new Error(`offline-cache-missing-${kind}: ${name}`);
    error.offlineBlocked = true;
    error.missing = { kind, name };
    throw error;
  }
  function sourceFile(root, path) {
    safeRelative(path);
    let current = root;
    for (const part of path.split("/")) {
      current = join(current, part);
      if (!existsSync(current)) return undefined;
      assert.ok(!lstatSync(current).isSymbolicLink(), "symlinked-cache-source");
    }
    const stat = lstatSync(current);
    assert.ok(stat.isFile() && stat.size <= 32 * 1024 * 1024, "invalid-cache-file");
    contained(root, current);
    return readFileSync(current);
  }
  function copy(root, path, target, bytes) {
    safeRelative(path);
    const destination = join(target, path);
    if (existsSync(destination)) {
      assert.ok(
        !lstatSync(destination).isSymbolicLink() && lstatSync(destination).isFile(),
        "invalid-seeded-file",
      );
      assert.equal(digest(readFileSync(destination)), digest(bytes), "seeded-content-mismatch");
      return;
    }
    receipt.files++;
    receipt.bytes += bytes.length;
    assert.ok(
      receipt.files <= 100_000 && receipt.bytes <= 512 * 1024 * 1024,
      "offline-seed-size-limit",
    );
    let parent = target;
    for (const part of path.split("/").slice(0, -1)) {
      parent = join(parent, part);
      if (existsSync(parent))
        assert.ok(
          lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(),
          "symlinked-cache-destination",
        );
      else mkdirSync(parent);
    }
    const mode = path.startsWith("files/") && path.endsWith("-exec") ? 0o700 : 0o600;
    writeFileSync(destination, bytes, { flag: "wx", mode });
    // Reads only: source data/config is never passed to a package-manager process.
    assert.equal(digest(sourceFile(root, path)), digest(bytes), "cache-source-changed");
  }
  function packageName(name) {
    assert.ok(
      name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name),
      "invalid-cache-package-name",
    );
  }
  function integrity(value) {
    const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(value ?? "");
    assert.ok(match, "invalid-cache-integrity");
    return Buffer.from(match[1], "base64").toString("hex");
  }
  function retry(error) {
    const diagnostic = error.diagnostic ?? "";
    if (diagnostic.includes("ERR_PNPM_NO_OFFLINE_META")) {
      const destination = /in package mirror ([^\r\n]+\.json)/.exec(diagnostic)?.[1];
      assert.ok(destination, "invalid-offline-metadata-error");
      const path = relative(metadata, resolve(destination)).replaceAll("\\", "/");
      safeRelative(path);
      assert.ok(path.endsWith(".json"), "invalid-cache-metadata-name");
      const name = path.slice(0, -5);
      packageName(name);
      if (seeded.has(name)) return false;
      assert.ok(seeded.size < 512, "offline-seed-count-limit");
      const bytes = sourceFile(sources[0], path);
      if (!bytes) missing("metadata", name);
      const data = JSON.parse(bytes);
      assert.equal(data.name, name, "cache-metadata-identity");
      assert.ok(
        data.versions && typeof data.versions === "object" && !Array.isArray(data.versions),
        "invalid-cache-metadata",
      );
      copy(sources[0], path, metadata, bytes);
      seeded.add(name);
      receipt.metadata.push({ name, sha256: digest(bytes) });
      return true;
    }
    if (diagnostic.includes("ERR_PNPM_NO_OFFLINE_TARBALL")) {
      const url = /https:\/\/registry\.npmjs\.org\/[^\s"'<>]+\.tgz/.exec(diagnostic)?.[0];
      if (!url) return false;
      const name = decodeURIComponent(new URL(url).pathname.split("/-/")[0].slice(1));
      packageName(name);
      const metadataBytes = sourceFile(metadata, name + ".json");
      if (!metadataBytes) missing("metadata", name);
      const entries = Object.values(JSON.parse(metadataBytes).versions).filter(
        (entry) => entry.dist?.tarball === url,
      );
      assert.equal(entries.length, 1, "ambiguous-cached-tarball");
      const selected = entries[0];
      assert.equal(selected.name, name, "cached-tarball-name");
      assert.match(
        selected.version,
        /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/,
        "invalid-cache-version",
      );
      const id = name + "@" + selected.version;
      if (receipt.packages.includes(id)) return false;
      const hash = integrity(selected.dist.integrity).slice(0, 64);
      const indexPath = `index/${hash.slice(0, 2)}/${hash.slice(2)}-${id.replaceAll("/", "+")}.json`;
      const indexBytes = sourceFile(sources[1], indexPath);
      if (!indexBytes) missing("package-index", id);
      const index = JSON.parse(indexBytes);
      assert.equal(index.name, name, "cache-index-name");
      assert.equal(index.version, selected.version, "cache-index-version");
      assert.ok(
        index.files && typeof index.files === "object" && !Array.isArray(index.files),
        "invalid-cache-index",
      );
      for (const [file, entry] of Object.entries(index.files)) {
        safeRelative(file);
        assert.ok(Number.isSafeInteger(entry.mode), "invalid-cache-file-mode");
        const hash = integrity(entry.integrity);
        const path = `files/${hash.slice(0, 2)}/${hash.slice(2)}${entry.mode & 73 ? "-exec" : ""}`;
        const bytes = sourceFile(sources[1], path);
        if (!bytes) missing("package-bytes", id + "/" + file);
        assert.equal(
          createHash("sha512").update(bytes).digest("hex"),
          hash,
          "cached-package-integrity",
        );
        copy(sources[1], path, store, bytes);
      }
      copy(sources[1], indexPath, store, indexBytes);
      receipt.packages.push(id);
      return true;
    }
    return false;
  }
  return { store, receipt, retry };
}

export function installConsumer(
  receipt,
  closure,
  consumer,
  tool,
  env,
  { offline = true, store, cacheSeed } = {},
) {
  verifyReceipt(receipt, closure);
  mkdirSync(consumer);
  const dependencies = Object.fromEntries(
    receipt.map((item) => [item.name, "file:" + item.tarball.replaceAll("\\", "/")]),
  );
  if (dependencies["@kleio/coder"]) dependencies[LEGACY_CODER] = dependencies["@kleio/coder"];
  writeFileSync(
    join(consumer, "package.json"),
    json({
      name: "kleio-public-consumer",
      private: true,
      type: "module",
      dependencies,
      pnpm: { overrides: dependencies },
    }),
  );
  assert.ok(
    !cacheSeed || (offline && store === cacheSeed.store),
    "offline-seed-requires-disposable-store",
  );
  const deadline = Date.now() + 120_000;
  for (;;) {
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, "offline-install-time-limit");
    try {
      pnpm(
        tool,
        [
          "install",
          "--ignore-scripts",
          "--ignore-pnpmfile",
          "--config.side-effects-cache=false",
          ...(offline ? ["--offline"] : []),
          ...(store ? ["--store-dir", store] : []),
          "--reporter=append-only",
        ],
        consumer,
        { ...env, GIT_ALLOW_PROTOCOL: "" },
        remaining,
      );
      break;
    } catch (error) {
      if (!cacheSeed?.retry(error)) throw error;
    }
  }
  verifyReceipt(receipt, closure);
  const packageRoots = {};
  for (const item of receipt) {
    const root = contained(consumer, join(consumer, "node_modules", item.name));
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(manifest.name, item.name, "installed-name");
    assert.equal(manifest.version, item.version, "installed-version");
    assert.deepEqual(manifest.exports, item.exports, "installed-exports");
    assert.deepEqual(manifest.bin, item.bin, "installed-bin");
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        assert.ok(!spec.startsWith("workspace:"), "unconverted-workspace-protocol");
        if (closure.has(name)) {
          assert.equal(spec, closure.get(name).manifest.version, "converted-workspace-version");
          // Resolve from the actual installed parent, not from the consumer root alone.
          const resolution = run(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `console.log(import.meta.resolve(${JSON.stringify(name)}))`,
            ],
            root,
            env,
          ).trim();
          assert.ok(resolution.startsWith("file:"), "registry-workspace-substitute");
          const resolved = contained(consumer, fileURLToPath(resolution));
          contained(realpathSync(join(consumer, "node_modules", name)), resolved);
        }
      }
    }
    function targets(value) {
      if (typeof value === "string") {
        assert.ok(value.startsWith("./"), "invalid-export-target");
        const path = value.slice(2);
        safeRelative(path);
        assert.ok(item.files.includes(path), "missing-packed-target: " + path);
        assert.ok(
          lstatSync(contained(root, join(root, path))).isFile(),
          "missing-installed-target",
        );
      } else if (value && typeof value === "object") Object.values(value).forEach(targets);
    }
    targets(manifest.exports);
    targets(manifest.bin);
    packageRoots[item.name] = root;
  }
  if (dependencies[LEGACY_CODER]) {
    const alias = contained(consumer, join(consumer, "node_modules", LEGACY_CODER));
    assert.equal(
      JSON.parse(readFileSync(join(alias, "package.json"))).name,
      "@kleio/coder",
      "legacy-alias-identity",
    );
  }
  return { packageRoots, lockDigest: digest(readFileSync(join(consumer, "pnpm-lock.yaml"))) };
}

// Progress is observable, but installation has no injected executor or online retry.
// Registry reads populate only a disposable store; verification always starts fresh offline.
export function* installConsumerPhases(
  receipt,
  closure,
  home,
  tool,
  env,
  { registryRead = false, store, cacheSeed } = {},
) {
  let population;
  const populationConsumer = join(home, "population");
  const consumer = join(home, "consumer");
  if (registryRead) {
    yield { stage: "population", status: "running" };
    assert.ok(!store && !cacheSeed, "registry-population-requires-disposable-store");
    contained(home, env.HOME);
    store = join(env.HOME, "package-store");
    mkdirSync(store);
    population = installConsumer(receipt, closure, populationConsumer, tool, env, {
      offline: false,
      store,
    });
    yield { stage: "population", status: "passed", consumer: populationConsumer, ...population };
  }
  yield { stage: "install", status: "running" };
  const installed = installConsumer(receipt, closure, consumer, tool, env, {
    offline: true,
    store,
    cacheSeed,
  });
  if (population) {
    const populationDigest = digest(readFileSync(join(populationConsumer, "pnpm-lock.yaml")));
    assert.equal(populationDigest, population.lockDigest, "consumer-resolution-drift");
    assert.equal(installed.lockDigest, population.lockDigest, "consumer-resolution-drift");
  }
  verifyReceipt(receipt, closure);
  yield { stage: "install", status: "passed", consumer, ...installed };
}

export function compileConsumer(consumer, compiler, env) {
  const output = run(
    process.execPath,
    [
      compiler,
      "--strict",
      "--noEmit",
      "--listFiles",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "consumer.ts",
    ],
    consumer,
    env,
  );
  const root = realpathSync(consumer);
  const standardLibrary = realpathSync(join(dirname(realpathSync(compiler)), "..", "lib"));
  for (const file of output.trim().split(/\r?\n/)) {
    const path = realpathSync(resolve(consumer, file));
    const location = relative(root, path);
    if (location && !location.startsWith("..") && !isAbsolute(location)) continue;
    // The compiler is tooling; only its own standard libraries may be external.
    const library = relative(standardLibrary, path);
    assert.ok(/^lib(?:\.[a-z0-9.]+)?\.d\.ts$/.test(library), "type-resolution-outside-consumer");
  }
}

export async function runConsumerContracts({
  root = ROOT,
  candidateSha,
  registryRead = false,
  metadataSource,
} = {}) {
  assert.match(candidateSha, /^[0-9a-f]{40}$/, "candidate-sha-required");
  assert.ok(
    !metadataSource || (!registryRead && typeof metadataSource === "string"),
    "metadata-seed-offline-only",
  );
  if (registryRead)
    assert.ok(
      process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted",
      "registry-reads-require-hosted-runner",
    );
  // pnpm derives file-tarball cache keys relative to its real cwd. Resolve macOS
  // /var aliases before constructing paths, especially inside the trusted shell's temp home.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "kleio-consumer-")));
  const report = {
    candidateSha,
    outcomes: [],
    networkPolicy: registryRead
      ? "registry-population-then-pnpm-offline-no-hooks"
      : "pnpm-offline-no-hooks",
    offlineEnforcement: "package-manager; not an operating-system network sandbox",
    stages: {
      pack: "not-run",
      population: "not-run",
      install: "not-run",
      runtime: "not-run",
      declarations: "not-run",
      identity: "not-run",
    },
  };
  let stage = "pack";
  try {
    root = realpathSync(root);
    const env = isolatedEnvironment(join(home, "home"));
    assert.equal(
      run("git", ["-c", "core.fsmonitor=false", "rev-parse", "HEAD"], root, env).trim(),
      candidateSha,
      "consumer-head-mismatch",
    );
    const tool = packageManager();
    assert.match(
      run(tool.command, [...tool.prefix, "--version"], home, env).trim(),
      /^10\./,
      "pnpm-10-required",
    );
    // A read-only cache-location query may use the original home, but never its
    // auth/config environment or hooks. Pack/install always keep the fresh home.
    const store = registryRead
      ? undefined
      : pnpm(tool, ["store", "path"], ROOT, {
          ...env,
          HOME: homedir(),
          USERPROFILE: homedir(),
        }).trim();
    const cacheSeed = metadataSource
      ? offlineCacheSeed(metadataSource, store, env.HOME)
      : undefined;
    if (cacheSeed) report.offlineCache = cacheSeed.receipt;
    const closure = workspaceClosure(root, tool, env);
    const output = join(home, "tarballs");
    mkdirSync(output);
    const receipt = [...closure.values()].map((item) => packPackage(item, output, tool, env));
    report.tarballs = receipt.map(({ name, version, sha256 }) => ({ name, version, sha256 }));
    report.outcomes.push({ contract: "pack", status: "passed" });
    report.stages.pack = "passed";
    stage = "install";
    const consumer = join(home, "consumer");
    let installed;
    for (const progress of installConsumerPhases(receipt, closure, home, tool, env, {
      registryRead,
      store: cacheSeed?.store ?? store,
      cacheSeed,
    })) {
      stage = progress.stage;
      report.stages[stage] = progress.status;
      if (progress.status !== "passed") continue;
      if (stage === "population") {
        report.populationLockDigest = progress.lockDigest;
        report.outcomes.push({ contract: "population", status: "passed" });
      } else {
        installed = progress;
        report.lockDigest = progress.lockDigest;
        report.locations = progress.packageRoots;
        report.outcomes.push({ contract: "installed-closure", status: "passed" });
      }
    }
    stage = "runtime";
    for (const file of ["consumer.mjs", "consumer.ts"])
      copyFileSync(new URL("./consumer-fixture/" + file, import.meta.url), join(consumer, file));
    const runtime = run(process.execPath, [join(consumer, "consumer.mjs")], consumer, env);
    report.outcomes.push(...JSON.parse(runtime).outcomes);
    report.stages.runtime = "passed";
    stage = "declarations";
    const compiler = join(
      installed.packageRoots["@kleio/coder"],
      "node_modules/typescript/bin/tsc",
    );
    // Locate tooling via its installed dependency, never resolve package types in the checkout.
    const compilerPath = existsSync(compiler)
      ? compiler
      : fileURLToPath(
          run(
            process.execPath,
            ["--input-type=module", "-e", 'console.log(import.meta.resolve("typescript/bin/tsc"))'],
            installed.packageRoots["@kleio/coder"],
            env,
          ).trim(),
        );
    contained(consumer, compilerPath);
    compileConsumer(consumer, compilerPath, env);
    report.outcomes.push({ contract: "declarations", status: "passed" });
    report.stages.declarations = "passed";
    stage = "identity";
    const canonicalRoots = Object.fromEntries(
      Object.values(CANONICAL_PACKAGES).map((name) => [name, installed.packageRoots[name]]),
    );
    const audit = await auditInstalledPackages({
      consumerRoot: consumer,
      packageRoots: canonicalRoots,
    });
    assert.equal(
      audit.status,
      "passed",
      "installed-identity: " +
        json({
          unclassified: audit.unclassified.slice(0, 5),
          counts: audit.countMismatches.slice(0, 10),
        }),
    );
    report.stages.identity = "passed";
    report.outcomes.push({ contract: "installed-identity", status: "passed" });
    report.status = "passed";
    return report;
  } catch (error) {
    report.status =
      stage === "install" &&
      (error.offlineBlocked || /ERR_PNPM_NO_OFFLINE_(?:META|TARBALL)/.test(error.diagnostic ?? ""))
        ? "blocked"
        : "failed";
    report.stages[stage] = report.status;
    if (error.missing) report.missing = error.missing;
    report.outcomes.push({
      contract: "consumer",
      status: report.status,
      reason: error.message.slice(0, 4000),
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    });
    error.report = report;
    throw error;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    assert.ok(
      args.length >= 2 && args[0] === "--sha" && args.length <= 7,
      "invalid-consumer-arguments",
    );
    const options = { candidateSha: args[1] };
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--root" && !options.root) {
        assert.ok(args[i + 1] && !args[i + 1].startsWith("--"), "invalid-consumer-root");
        options.root = args[++i];
      } else if (args[i] === "--metadata-source" && !options.metadataSource) {
        assert.ok(args[i + 1] && !args[i + 1].startsWith("--"), "invalid-metadata-source");
        options.metadataSource = args[++i];
      } else if (args[i] === "--registry-read" && !options.registryRead)
        options.registryRead = true;
      else throw new Error("invalid-consumer-arguments");
    }
    console.log(json(await runConsumerContracts(options)));
  } catch (error) {
    console.error(json(error.report ?? { status: "failed", reason: error.message }));
    process.exitCode = 1;
  }
}
