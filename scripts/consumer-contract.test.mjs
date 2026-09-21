import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  chmodSync,
  statSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { devNull, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  isolatedEnvironment,
  packageManager,
  pnpm,
  packPackage,
  installConsumer,
  offlineCacheSeed,
  compileConsumer,
  verifyReceipt,
  workspaceClosure,
  run,
  LEGACY_CODER,
} from "./consumer-contract.mjs";
import * as consumerContract from "./consumer-contract.mjs";
import { CANONICAL_PACKAGES } from "./identity-audit.mjs";

const tool = packageManager();
const coderDirectory = Object.entries(CANONICAL_PACKAGES).find(
  ([, name]) => name === "@kleio/coder",
)[0];
const coderRoot = join(
  process.env.KLEIO_CI_ROOT ?? fileURLToPath(new URL("../", import.meta.url)),
  coderDirectory,
);
const compiler = join(coderRoot, "node_modules/typescript/bin/tsc");
function fixture(t) {
  // Native realpath so the fixture's spelling matches what pnpm, tsc and the
  // scripts report (Windows runners hand out os.tmpdir() as an 8.3 alias).
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "kleio-pack-test-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = join(home, "package");
  const output = join(home, "tarballs");
  mkdirSync(directory);
  mkdirSync(output);
  const env = isolatedEnvironment(join(home, "isolated"));
  const marker = join(home, "hook-executed");
  const hook = "node hook.cjs";
  writeFileSync(
    join(directory, "hook.cjs"),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`,
  );
  const manifest = {
    name: "kleio-contract-fixture",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.js" },
    files: ["index.js", "index.d.ts", "hook.cjs"],
    scripts: Object.fromEntries(
      ["prepack", "prepare", "postpack", "preinstall", "install", "postinstall"].map((name) => [
        name,
        hook,
      ]),
    ),
  };
  writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(directory, "index.js"), "export const value = 42;\n");
  writeFileSync(join(directory, "index.d.ts"), "export declare const value: number;\n");
  writeFileSync(
    join(directory, ".pnpmfile.cjs"),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'pnpmfile'); module.exports = {};`,
  );
  // Local config must not override the explicit suppression flags.
  writeFileSync(join(directory, ".npmrc"), "ignore-scripts=false\nignore-pnpmfile=false\n");
  return { home, directory, output, env, marker, manifest };
}

test("packageManager skips a newer pnpm bundle beside the requested pnpm 10 shim", (t) => {
  // pnpm/action-setup on Windows: node_modules/pnpm is the v11 self-installer,
  // which then places the requested v10 behind a shim under .bin/bin/. PATH order
  // alone picked the v11 bundle, and every consumer install ran pnpm 11.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "kleio-pnpm-layout-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "node_modules", ".bin");
  const fakeEleven = join(root, "node_modules", "pnpm", "bin", "pnpm.cjs");
  mkdirSync(dirname(fakeEleven), { recursive: true });
  writeFileSync(fakeEleven, 'process.stdout.write("11.19.0\\n");\n');
  // The real pnpm 10 is only reachable through a shim that names its script,
  // exactly as cmd-shim writes it (relative to the shim's own directory).
  assert.ok(tool.prefix[0], "test needs a script-based pnpm to point the shim at");
  const shimDirectory = join(bin, "bin");
  mkdirSync(shimDirectory, { recursive: true });
  const target = relative(shimDirectory, tool.prefix[0]);
  writeFileSync(
    join(shimDirectory, "pnpm.cmd"),
    `@"%~dp0\\node.exe"  "%~dp0\\${target.split(sep).join("\\")}" %*\r\n`,
  );
  writeFileSync(
    join(shimDirectory, "pnpm"),
    `#!/bin/sh\nexec node  "$basedir/${target.split(sep).join("/")}" "$@"\n`,
  );
  const saved = process.env.PATH;
  process.env.PATH = bin + (process.platform === "win32" ? ";" : ":") + saved;
  t.after(() => (process.env.PATH = saved));
  const found = packageManager();
  assert.notEqual(found.prefix[0], fakeEleven, "the pnpm 11 bundle must be rejected");
  assert.equal(found.prefix[0], tool.prefix[0], "resolves through the shim to the real script");
});

test("isolated config paths are distinct empty files inside the home, never the null device", (t) => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "kleio-isolated-env-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = isolatedEnvironment(join(home, "h"));
  const files = [env.npm_config_userconfig, env.npm_config_globalconfig, env.GIT_CONFIG_GLOBAL];
  // pnpm >= 10.3x rejects one path loaded as both user and global config; on
  // Windows os.devNull is \\.\nul, which git cannot access() as a config file.
  assert.equal(new Set(files).size, files.length, "each config role gets its own file");
  for (const file of files) {
    assert.ok(file.startsWith(join(home, "h") + sep), "config lives inside the isolated home");
    assert.equal(readFileSync(file, "utf8"), "", "no inherited settings");
  }
  for (const [key, value] of Object.entries(env))
    assert.notEqual(value, devNull, key + " must not point at the null device");
  // Calling again on the same home is idempotent: same paths, still empty.
  const again = isolatedEnvironment(join(home, "h"));
  assert.deepEqual(
    [again.npm_config_userconfig, again.npm_config_globalconfig, again.GIT_CONFIG_GLOBAL],
    files,
  );
  // Both tools must accept the files; these are the exact calls that broke in CI.
  assert.equal(
    pnpm(tool, ["config", "get", "registry"], join(home, "h"), env).trim(),
    "https://registry.npmjs.org/",
  );
  const git = spawnSync("git", ["config", "--global", "--list"], { env, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  assert.equal(git.stdout.trim(), "");
});

test("real pack/install suppress lifecycle and pnpmfile hooks and scrub credentials", (t) => {
  const f = fixture(t);
  const userconfig = join(f.home, "user.npmrc");
  writeFileSync(userconfig, "registry=https://config-sentinel.invalid/\n");
  const keys = {
    NODE_PATH: "sentinel",
    NODE_OPTIONS: "sentinel",
    NPM_TOKEN: "sentinel",
    GITHUB_TOKEN: "sentinel",
    npm_config_registry: "sentinel",
    npm_config_userconfig: userconfig,
  };
  const old = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, keys);
    const clean = isolatedEnvironment(join(f.home, "other-home"));
    for (const [key, value] of Object.entries(keys)) assert.notEqual(clean[key], value, key);
    assert.equal(
      pnpm(tool, ["config", "get", "registry"], f.home, clean).trim(),
      "https://registry.npmjs.org/",
    );
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  // Prove both sentinels can execute, independently of suppression.
  run(process.execPath, [join(f.directory, "hook.cjs")], f.directory, f.env);
  assert.equal(readFileSync(f.marker, "utf8"), "executed");
  rmSync(f.marker);
  run(process.execPath, [join(f.directory, ".pnpmfile.cjs")], f.directory, f.env);
  assert.equal(readFileSync(f.marker, "utf8"), "pnpmfile");
  rmSync(f.marker);
  const item = { directory: f.directory, manifest: f.manifest };
  const packed = packPackage(item, f.output, tool, f.env);
  assert.equal(existsSync(f.marker), false, "pack hook suppression");
  const closure = new Map([[f.manifest.name, item]]);
  const consumer = join(f.home, "consumer");
  const installed = installConsumer([packed], closure, consumer, tool, f.env);
  assert.equal(existsSync(f.marker), false, "install hook suppression");
  assert.match(installed.lockDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    readFileSync(join(installed.packageRoots[f.manifest.name], "index.js"), "utf8"),
    "export const value = 42;\n",
  );
  verifyReceipt([packed], closure);
});

function seededFixture(t) {
  const f = fixture(t);
  const metadataSource = join(f.home, "registry-metadata");
  const storeSource = join(f.home, "read-only-store");
  mkdirSync(metadataSource);
  mkdirSync(storeSource);
  chmodSync(join(f.directory, "hook.cjs"), 0o755);
  const publicTarball = packPackage(
    { directory: f.directory, manifest: f.manifest },
    f.output,
    tool,
    f.env,
  );
  const tarball = `https://registry.npmjs.org/${f.manifest.name}/-/${f.manifest.name}-1.0.0.tgz`;
  const hash = createHash("sha512").update(readFileSync(publicTarball.tarball)).digest();
  const meta = {
    name: f.manifest.name,
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": { ...f.manifest, dist: { tarball, integrity: "sha512-" + hash.toString("base64") } },
    },
  };
  const sourceFiles = [];
  function sourceFile(root, path, bytes) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, bytes);
    sourceFiles.push([file, Buffer.from(bytes)]);
  }
  sourceFile(metadataSource, f.manifest.name + ".json", JSON.stringify(meta));
  sourceFile(metadataSource, ".npmrc", "credential-fixture-never-copy");
  const files = {};
  for (const file of publicTarball.files) {
    const bytes = readFileSync(join(f.directory, file));
    const digest = createHash("sha512").update(bytes).digest();
    const hex = digest.toString("hex");
    const mode = file === "hook.cjs" ? 0o755 : 0o644;
    sourceFile(
      storeSource,
      `files/${hex.slice(0, 2)}/${hex.slice(2)}${mode & 73 ? "-exec" : ""}`,
      bytes,
    );
    files[file] = {
      integrity: "sha512-" + digest.toString("base64"),
      mode,
      size: bytes.length,
      checkedAt: Date.now(),
    };
  }
  const key = hash.toString("hex").slice(0, 64);
  const indexPath = `index/${key.slice(0, 2)}/${key.slice(2)}-${f.manifest.name}@1.0.0.json`;
  sourceFile(
    storeSource,
    indexPath,
    JSON.stringify({ name: f.manifest.name, version: "1.0.0", files }),
  );
  const parent = join(f.home, "parent");
  mkdirSync(parent);
  const manifest = {
    name: "seed-parent-fixture",
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    files: ["index.js"],
    dependencies: { [f.manifest.name]: "^1.0.0" },
  };
  writeFileSync(join(parent, "package.json"), JSON.stringify(manifest));
  writeFileSync(
    join(parent, "index.js"),
    `export { value } from ${JSON.stringify(f.manifest.name)};`,
  );
  const item = { directory: parent, manifest };
  const receipt = [packPackage(item, f.output, tool, f.env)];
  const closure = new Map([[manifest.name, item]]);
  const cacheSeed = offlineCacheSeed(metadataSource, storeSource, f.env.HOME);
  return { ...f, metadataSource, storeSource, sourceFiles, cacheSeed, receipt, closure, indexPath };
}

test("offline metadata and verified bytes are staged on demand without source/config writes", (t) => {
  const f = seededFixture(t);
  const consumer = join(f.home, "consumer");
  installConsumer(f.receipt, f.closure, consumer, tool, f.env, {
    offline: true,
    store: f.cacheSeed.store,
    cacheSeed: f.cacheSeed,
  });
  assert.equal(
    run(
      process.execPath,
      ["--input-type=module", "-e", "console.log((await import('seed-parent-fixture')).value)"],
      consumer,
      f.env,
    ).trim(),
    "42",
  );
  assert.deepEqual(
    f.cacheSeed.receipt.metadata.map((item) => item.name),
    [f.manifest.name],
  );
  assert.deepEqual(f.cacheSeed.receipt.packages, [f.manifest.name + "@1.0.0"]);
  assert.equal(existsSync(join(f.env.HOME, "pnpm/metadata-v1.3/registry.npmjs.org/.npmrc")), false);
  assert.equal(existsSync(f.marker), false);
  for (const [path, bytes] of f.sourceFiles) assert.deepEqual(readFileSync(path), bytes, path);
  const executable = f.sourceFiles.find(([path]) => path.endsWith("-exec"))[0];
  const copied = executable.replace(f.storeSource, f.cacheSeed.store);
  assert.ok(existsSync(copied));
  if (process.platform !== "win32")
    assert.ok(statSync(copied).mode & 0o100, "owner-execute-preserved");
});

test("cache seeding rejects source/destination overlap before writing", (t) => {
  const f = fixture(t);
  assert.throws(() => offlineCacheSeed(f.home, f.home, f.env.HOME), /overlapping-cache-source/);
  assert.equal(existsSync(join(f.env.HOME, "pnpm")), false);
});

test("cache seeding reports missing metadata/bytes and rejects symlinks, drift and online use", async (t) => {
  for (const kind of ["metadata", "index", "bytes", "integrity", "symlink", "online"])
    await t.test(kind, (t) => {
      const f = seededFixture(t);
      const metadataFile = join(f.metadataSource, f.manifest.name + ".json");
      const byteFile = f.sourceFiles.find(([path]) =>
        path.replaceAll("\\", "/").includes("/files/"),
      )[0];
      if (kind === "metadata") rmSync(metadataFile);
      if (kind === "index") rmSync(join(f.storeSource, f.indexPath));
      if (kind === "bytes") rmSync(byteFile);
      if (kind === "integrity") writeFileSync(byteFile, "changed");
      if (kind === "symlink") {
        const outside = join(f.home, "other-metadata.json");
        writeFileSync(outside, readFileSync(metadataFile));
        rmSync(metadataFile);
        symlinkSync(outside, metadataFile);
      }
      const reasons = {
        metadata: /offline-cache-missing-metadata/,
        index: /offline-cache-missing-package-index/,
        bytes: /offline-cache-missing-package-bytes/,
        integrity: /cached-package-integrity/,
        symlink: /symlinked-cache-source/,
        online: /offline-seed-requires-disposable-store/,
      };
      assert.throws(
        () =>
          installConsumer(f.receipt, f.closure, join(f.home, "consumer"), tool, f.env, {
            offline: kind !== "online",
            store: f.cacheSeed.store,
            cacheSeed: f.cacheSeed,
          }),
        reasons[kind],
      );
    });
});

// The production coordinator exposes progress, not a replacement installer or retry hook.
function phases(f, options = {}) {
  assert.equal(typeof consumerContract.installConsumerPhases, "function");
  const trace = join(f.home, "pnpm-invocations.jsonl");
  const wrapper = join(f.home, "trace-pnpm.cjs");
  // Observe argv while delegating every install to the real installed package manager.
  writeFileSync(
    wrapper,
    `
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(trace)}, JSON.stringify({args, cwd: process.cwd()}) + '\\n');
const result = spawnSync(${JSON.stringify(tool.command)}, [...${JSON.stringify(tool.prefix)}, ...args], {stdio: 'inherit', env: process.env});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`,
  );
  f.invocations = () =>
    existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse) : [];
  return consumerContract.installConsumerPhases(
    f.receipt,
    f.closure,
    f.home,
    { command: process.execPath, prefix: [wrapper] },
    f.env,
    options,
  );
}

test("two-phase installation uses identical authoritative receipts in distinct fresh consumers", (t) => {
  const f = publicFixture(t);
  f.receipt = [...f.closure.values()].map((item) => packPackage(item, f.output, tool, f.env));
  const original = structuredClone(f.receipt);
  const events = [...phases(f, { registryRead: true })];
  assert.deepEqual(
    events.map(({ stage, status }) => [stage, status]),
    [
      ["population", "running"],
      ["population", "passed"],
      ["install", "running"],
      ["install", "passed"],
    ],
  );
  const calls = f.invocations();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.includes("--offline"), false);
  assert.equal(calls[1].args.includes("--offline"), true, "mandatory offline replay");
  const stores = calls.map(({ args }) => args[args.indexOf("--store-dir") + 1]);
  assert.equal(stores[0], stores[1]);
  assert.ok(stores[0].startsWith(f.home));
  const population = events[1];
  const installed = events[3];
  assert.notEqual(population.consumer, installed.consumer);
  assert.equal(population.lockDigest, installed.lockDigest);
  for (const result of [population, installed]) {
    assert.ok(result.consumer.startsWith(f.home));
    const manifest = JSON.parse(readFileSync(join(result.consumer, "package.json")));
    assert.deepEqual(manifest.dependencies, manifest.pnpm.overrides);
    for (const item of original) {
      assert.equal(manifest.dependencies[item.name], "file:" + item.tarball.replaceAll("\\", "/"));
      // Package roots are canonical (8.3 aliases expanded on Windows); compare like for like.
      assert.ok(
        result.packageRoots[item.name].startsWith(realpathSync.native(result.consumer) + sep),
      );
    }
    assert.equal(manifest.dependencies[LEGACY_CODER], manifest.dependencies["@kleio/coder"]);
  }
  assert.deepEqual(f.receipt, original);
  verifyReceipt(f.receipt, f.closure);
});

test("two-phase population and offline replay suppress hooks and exclude credential/config sentinels", (t) => {
  const f = fixture(t);
  const keys = {
    NPM_TOKEN: "credential-sentinel",
    NODE_PATH: "workspace-sentinel",
    npm_config_registry: "https://config-sentinel.invalid/",
  };
  const previous = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, keys);
    f.env = isolatedEnvironment(join(f.home, "clean-home"));
    for (const [key, value] of Object.entries(keys)) assert.notEqual(f.env[key], value);
    const item = { directory: f.directory, manifest: f.manifest };
    f.closure = new Map([[f.manifest.name, item]]);
    f.receipt = [packPackage(item, f.output, tool, f.env)];
    const events = [...phases(f, { registryRead: true })];
    assert.equal(events.at(-1).status, "passed");
    for (const event of events.filter((event) => event.status === "passed")) {
      assert.equal(
        pnpm(tool, ["config", "get", "registry"], event.consumer, f.env).trim(),
        "https://registry.npmjs.org/",
      );
      // pnpm records the store dir it resolved. Compare canonical forms on both
      // sides: on Windows the recorded path may differ from f.home in case,
      // 8.3 aliasing or separator, while still being the disposable store.
      const modules = readFileSync(join(event.consumer, "node_modules/.modules.yaml"), "utf8");
      // pnpm 10.3x writes this file as JSON, older 10.x as YAML; accept either.
      const recorded =
        modules.match(/^\s*"storeDir":\s*"(.+?)",?$/m)?.[1]?.replaceAll("\\\\", "\\") ??
        modules.match(/^storeDir:\s*(.+)$/m)?.[1]?.trim();
      assert.ok(recorded, "explicit disposable store: storeDir recorded\n" + modules);
      const location = relative(realpathSync.native(f.home), realpathSync.native(recorded));
      assert.ok(
        location && !location.startsWith("..") && !isAbsolute(location),
        `explicit disposable store: ${recorded} is outside ${f.home}`,
      );
    }
    assert.equal(existsSync(f.marker), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("two-phase replay rejects missing/changed receipts and resolution drift without continuing", async (t) => {
  for (const kind of ["missing", "changed", "resolution"])
    await t.test(kind, (t) => {
      const f = fixture(t);
      const item = { directory: f.directory, manifest: f.manifest };
      f.closure = new Map([[f.manifest.name, item]]);
      f.receipt = [packPackage(item, f.output, tool, f.env)];
      const sequence = phases(f, { registryRead: true });
      assert.equal(sequence.next().value.stage, "population");
      const population = sequence.next().value;
      assert.equal(population.status, "passed");
      if (kind === "missing") rmSync(f.receipt[0].tarball);
      if (kind === "changed") writeFileSync(f.receipt[0].tarball, "changed");
      if (kind === "resolution")
        writeFileSync(join(population.consumer, "pnpm-lock.yaml"), "changed-resolution\n");
      assert.deepEqual(sequence.next().value, { stage: "install", status: "running" });
      assert.throws(
        () => sequence.next(),
        {
          missing: /missing-local-tarball/,
          changed: /tarball-hash-mismatch/,
          resolution: /consumer-resolution-drift/,
        }[kind],
      );
      assert.equal(sequence.next().done, true, "no fallback or later verification");
      assert.equal(f.invocations().length, kind === "resolution" ? 2 : 1);
      assert.equal(existsSync(join(f.home, "consumer", "consumer.mjs")), false);
    });
});

test("production install coordinator defaults offline and never retries missing metadata/content online", async (t) => {
  for (const kind of ["metadata", "bytes"])
    await t.test(kind, (t) => {
      const f = seededFixture(t);
      if (kind === "metadata") rmSync(join(f.metadataSource, f.manifest.name + ".json"));
      else
        rmSync(f.sourceFiles.find(([path]) => path.replaceAll("\\", "/").includes("/files/"))[0]);
      const sequence = phases(f, { store: f.cacheSeed.store, cacheSeed: f.cacheSeed });
      assert.deepEqual(sequence.next().value, { stage: "install", status: "running" });
      assert.throws(
        () => sequence.next(),
        kind === "metadata"
          ? /offline-cache-missing-metadata/
          : /offline-cache-missing-package-bytes/,
      );
      assert.equal(sequence.next().done, true);
      assert.ok(f.invocations().length > 0);
      assert.ok(f.invocations().every(({ args }) => args.includes("--offline")));
      assert.equal(existsSync(join(f.home, "population")), false);
    });
});

test("production report leaves later stages explicitly not run after an offline prerequisite fails", async (t) => {
  const f = publicFixture(t, (name, manifest) => {
    if (name === "@kleio/core")
      manifest.dependencies = { "kleio-missing-offline-contract-fixture": "1.0.0" };
  });
  run("git", ["init", "--template="], f.root, f.env);
  const tree = run("git", ["write-tree"], f.root, f.env).trim();
  const sha = run(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@localhost",
      "commit-tree",
      tree,
      "-m",
      "fixture",
    ],
    f.root,
    f.env,
  ).trim();
  run("git", ["update-ref", "HEAD", sha], f.root, f.env);
  await assert.rejects(
    consumerContract.runConsumerContracts({ root: f.root, candidateSha: sha }),
    (error) => {
      assert.match(error.message, /ERR_PNPM_NO_OFFLINE_META/);
      assert.equal(error.report.status, "blocked");
      assert.equal(error.report.candidateSha, sha);
      assert.equal(error.report.tarballs.length, 6);
      assert.deepEqual(error.report.stages, {
        pack: "passed",
        population: "not-run",
        install: "blocked",
        runtime: "not-run",
        declarations: "not-run",
        identity: "not-run",
      });
      return true;
    },
  );
});

function publicFixture(t, mutation = () => {}) {
  const f = fixture(t);
  const root = join(f.home, "workspace");
  mkdirSync(root);
  writeFileSync(join(root, "package.json"), '{"name":"fixture-root","private":true}');
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  const names = { ...CANONICAL_PACKAGES, "packages/pixel": "@kenkaiiii/gg-pixel" };
  const closure = new Map();
  for (const [path, name] of Object.entries(names)) {
    const directory = join(root, path);
    mkdirSync(directory, { recursive: true });
    const manifest = {
      name,
      version: "4.10.1-kleio.1",
      type: "module",
      files: ["dist"],
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    };
    const files = {
      "dist/index.js": "export const fixture = true;",
      "dist/index.d.ts": "export declare const fixture: boolean;",
    };
    if (name === "@kleio/coder") {
      manifest.dependencies = {
        "@kleio/core": "workspace:*",
        "@kenkaiiii/gg-pixel": "workspace:*",
      };
      manifest.exports["./models"] = { import: "./dist/models.js", types: "./dist/models.d.ts" };
      manifest.exports["./auth"] = { import: "./dist/auth.js", types: "./dist/auth.d.ts" };
      files["dist/index.js"] = `
import { mkdir, writeFile, appendFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export class SessionManager {
  constructor(store) { this.store = store; }
  async create(cwd) { await mkdir(this.store, {recursive:true}); const path=join(this.store,randomUUID()+'.jsonl'); await writeFile(path,JSON.stringify({cwd})+'\\n'); return {path}; }
  async appendEntry(path, entry) { await appendFile(path,JSON.stringify(entry)+'\\n'); }
  async updateLeaf() {}
  async load(path) { return (await readFile(path,'utf8')).trim().split('\\n').map(JSON.parse); }
  async list(cwd) { const results=[]; for(const name of await readdir(this.store)){ const path=join(this.store,name); const entries=await this.load(path); if(entries[0].cwd!==cwd)continue; const messages=entries.slice(1).map(e=>e.message.content); results.push({path, firstPrompt:messages[0], preview:messages.find(m=>!m.startsWith('[Previous conversation summary]')).replace(/\\s+/g,' ').trim()}); } return results; }
}
export class AgentSession {}
export class AuthStorage {}
export function createTools() {}
export function buildSystemPrompt() {}
`;
      files["dist/index.d.ts"] =
        "export interface SessionInfo { firstPrompt?: string; } export declare class SessionManager {} export declare class AgentSession {}";
      files["dist/models.js"] =
        "export const MODELS=[{id:'fixture',provider:'anthropic'}]; export const getDefaultModel=()=>MODELS[0]; export const getModel=id=>MODELS.find(m=>m.id===id); export const getModelsForProvider=p=>MODELS.filter(m=>m.provider===p);";
      files["dist/models.d.ts"] =
        "export declare const getModel: (id: string)=>unknown; export declare const getDefaultModel: (provider:string)=>unknown; export declare const getModelsForProvider:(provider:string)=>unknown;";
      files["dist/auth.js"] =
        "export class AuthStorage {} export class NotLoggedInError extends Error {} export function loginAnthropic() {} export function loginOpenAI() {} export function refreshAnthropicToken() {} export function refreshOpenAIToken() {}";
      files["dist/auth.d.ts"] =
        "export declare class AuthStorage {} export interface OAuthCredentials { access: string; }";
    }
    if (name === "@kleio/core") {
      const profile = {
        brandName: "Kleio",
        coder: {
          displayName: "Kleio Coder",
          preferredCommand: "kleio-coder",
          legacyCommand: "ggcoder",
          agentHomeId: "ggcoder",
          legacyMcpClientName: "ggcoder",
          httpUserAgent: "KleioCoder/1.0",
          legacyHttpUserAgent: "Mozilla/5.0 (compatible; GGCoder/1.0)",
        },
        manager: {
          displayName: "Kleio Manager",
          preferredCommand: "kleio-manager",
          legacyCommand: "ggboss",
        },
      };
      files["dist/index.js"] =
        `export const KLEIO_PRODUCT_PROFILE=${JSON.stringify(profile)}; export const KLEIO_CODER_ERROR_DISPLAY={productName:'Kleio Coder'}; export const KLEIO_MANAGER_ERROR_DISPLAY={productName:'Kleio Manager'}; export function resolveEnvironmentAlias(env,preferred,legacy){return [preferred,...[legacy].flat()].map(n=>env[n]).find(v=>v!==undefined);}`;
      files["dist/index.d.ts"] =
        "export declare const KLEIO_PRODUCT_PROFILE: {coder:{displayName:'Kleio Coder'}}; export declare function resolveEnvironmentAlias(env:Record<string,string|undefined>,preferred:string,legacy:string):string|undefined;";
    }
    if (name === "@kleio/ai")
      files["dist/index.d.ts"] = "export interface Message {role:'user';content:string;}";
    if (name === "@kleio/coder" || name === "@kleio/manager") {
      const coder = name === "@kleio/coder";
      manifest.bin = coder
        ? { "kleio-coder": "./dist/cli.js", ggcoder: "./dist/cli.js" }
        : { "kleio-manager": "./dist/cli.js", ggboss: "./dist/cli.js" };
      files["dist/cli.js"] =
        `console.log(process.argv.includes('--help') ? ${JSON.stringify(coder ? "Kleio Coder" : "Kleio Manager")} : '4.10.1-kleio.1');`;
    }
    mutation(name, manifest, files);
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(directory, "dist"), { recursive: true });
      writeFileSync(join(directory, path), content);
    }
    closure.set(name, { directory, manifest });
  }
  // Reproduce pnpm's installed workspace links for authored, dependency-free fixtures.
  // The consumer is still installed only from actual tarballs outside this workspace.
  for (const item of closure.values()) {
    for (const name of Object.keys(item.manifest.dependencies ?? {})) {
      if (!closure.has(name)) continue;
      const path = join(item.directory, "node_modules", name);
      mkdirSync(join(path, ".."), { recursive: true });
      symlinkSync(
        closure.get(name).directory,
        path,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  }
  return { ...f, root, closure };
}

function installedFixture(t, mutation) {
  const f = publicFixture(t, mutation);
  const receipt = [...f.closure.values()].map((item) => packPackage(item, f.output, tool, f.env));
  const consumer = join(f.home, "consumer");
  const installed = installConsumer(receipt, f.closure, consumer, tool, f.env);
  for (const name of ["consumer.mjs", "consumer.ts"])
    copyFileSync(new URL("./consumer-fixture/" + name, import.meta.url), join(consumer, name));
  return { ...f, receipt, consumer, installed };
}

function runtime(f) {
  try {
    return JSON.parse(run(process.execPath, [join(f.consumer, "consumer.mjs")], f.consumer, f.env));
  } catch (error) {
    throw new Error(error.diagnostic, { cause: error });
  }
}

test("workspace closure is the same whether the root is spelled directly or through an alias", (t) => {
  // Windows runners hand out os.tmpdir() as an 8.3 alias (C:\\Users\\RUNNER~1\\...)
  // while pnpm reports long names; a symlinked root is the portable equivalent
  // of one directory with two spellings. Both must canonicalise to one form.
  const f = publicFixture(t);
  const alias = join(f.home, "alias");
  symlinkSync(f.root, alias, "dir");
  const direct = workspaceClosure(f.root, tool, f.env);
  const viaAlias = workspaceClosure(alias, tool, f.env);
  assert.deepEqual([...viaAlias.keys()].sort(), [...direct.keys()].sort());
  for (const [name, item] of direct) {
    assert.equal(viaAlias.get(name).directory, item.directory);
    assert.ok(
      !item.directory.includes(sep + "alias" + sep),
      "package paths are canonical, not aliased",
    );
  }
});

test("complete real tarball closure passes runtime and strict external declaration contracts offline", (t) => {
  const f = installedFixture(t);
  assert.deepEqual(
    [...workspaceClosure(f.root, tool, f.env).keys()].sort(),
    [...f.closure.keys()].sort(),
  );
  assert.equal(runtime(f).outcomes.length, 6);
  assert.equal(
    JSON.parse(readFileSync(join(f.consumer, "node_modules", LEGACY_CODER, "package.json"))).name,
    "@kleio/coder",
  );
  compileConsumer(f.consumer, compiler, f.env);
});

test("published coder declares React types as a consumer dependency", () => {
  const manifest = JSON.parse(readFileSync(join(coderRoot, "package.json")));
  assert.equal(
    typeof manifest.dependencies["@types/react"],
    "string",
    "React types must ship to consumers",
  );
  assert.equal(manifest.devDependencies["@types/react"], undefined);
});

test("fresh theme declarations preserve the public shape in a strict NodeNext consumer", (t) => {
  const f = fixture(t);
  const themeDirectory = join(coderRoot, "src/ui/theme");
  const palettes = readdirSync(themeDirectory).filter((file) => file.endsWith(".json"));
  copyFileSync(join(themeDirectory, "theme.ts"), join(f.directory, "theme.ts"));
  for (const file of palettes) copyFileSync(join(themeDirectory, file), join(f.directory, file));
  const consumer = join(f.home, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module" }));
  // Use the installed real declarations, not ambient stubs or checkout resolution.
  const reactTypes = createRequire(join(coderRoot, "package.json")).resolve(
    "@types/react/package.json",
  );
  const cssTypes = createRequire(reactTypes).resolve("csstype/package.json");
  for (const directory of [f.directory, consumer]) {
    for (const [name, manifest] of [
      ["@types/react", reactTypes],
      ["csstype", cssTypes],
    ])
      cpSync(dirname(manifest), join(directory, "node_modules", name), { recursive: true });
  }
  run(
    process.execPath,
    [
      compiler,
      "--strict",
      "--declaration",
      "--emitDeclarationOnly",
      "--verbatimModuleSyntax",
      "--module",
      "ESNext",
      "--moduleResolution",
      "bundler",
      "--target",
      "ES2022",
      "--resolveJsonModule",
      "--types",
      "react",
      "--outDir",
      "declarations",
      "theme.ts",
    ],
    f.directory,
    f.env,
  );
  copyFileSync(join(f.directory, "declarations/theme.d.ts"), join(consumer, "theme.d.ts"));
  for (const file of palettes) copyFileSync(join(themeDirectory, file), join(consumer, file));
  const palette = JSON.parse(readFileSync(join(themeDirectory, "dark.json")));
  const fields = Object.keys(palette)
    .map((key) => `${JSON.stringify(key)}: string;`)
    .join("\n");
  writeFileSync(
    join(consumer, "consumer.ts"),
    `
import { loadTheme, ThemeContext, useTheme, type Theme } from "./theme.js";
import type { Context } from "react";
type Palette = { ${fields} };
const loaded: Palette = loadTheme("dark");
const roundTrip: Theme = loaded;
const current: Palette = useTheme();
const context: Context<Theme> = ThemeContext;
void [roundTrip, current, context];
`,
  );
  compileConsumer(consumer, compiler, f.env);
});

test("packed behavior negatives fail the specific public contract", async (t) => {
  for (const [name, packageName, before, after, reason] of [
    ["absent first prompt", "@kleio/coder", "firstPrompt:messages[0],", "", /firstPrompt/],
    [
      "wrong first prompt",
      "@kleio/coder",
      "firstPrompt:messages[0]",
      "firstPrompt:'wrong'",
      /firstPrompt/,
    ],
    [
      "branding",
      "@kleio/core",
      '"displayName":"Kleio Coder"',
      '"displayName":"Other"',
      /product-profile/,
    ],
    [
      "reversed precedence",
      "@kleio/core",
      "[preferred,...[legacy].flat()]",
      "[...[legacy].flat(),preferred]",
      /preferred-precedence/,
    ],
    [
      "empty precedence",
      "@kleio/core",
      "v!==undefined",
      "Boolean(v)",
      /empty-preferred-precedence/,
    ],
  ])
    await t.test(name, (t) => {
      const f = installedFixture(t, (name, manifest, files) => {
        if (name === packageName) {
          assert.ok(files["dist/index.js"].includes(before));
          files["dist/index.js"] = files["dist/index.js"].replace(before, after);
        }
      });
      assert.throws(() => runtime(f), reason);
    });
});

test("missing JS, declarations and export/bin targets are not rescued by checkout files", async (t) => {
  for (const [name, mutate, reason] of [
    [
      "JS",
      (manifest) => {
        manifest.files = [
          "dist/index.d.ts",
          "dist/cli.js",
          "dist/models.js",
          "dist/models.d.ts",
          "dist/auth.js",
          "dist/auth.d.ts",
        ];
      },
      /missing-packed-target: dist\/index.js/,
    ],
    [
      "declaration",
      (manifest) => {
        manifest.files = ["dist/*.js"];
      },
      /missing-packed-target: dist\/index.d.ts/,
    ],
    [
      "export",
      (manifest) => {
        manifest.exports["."].import = "./dist/missing.js";
      },
      /missing-packed-target: dist\/missing.js/,
    ],
    [
      "bin",
      (manifest) => {
        manifest.bin["kleio-coder"] = "./dist/missing-cli.js";
      },
      /missing-packed-target: dist\/missing-cli.js/,
    ],
  ])
    await t.test(name, (t) => {
      const f = publicFixture(t, (name, manifest) => {
        if (name === "@kleio/coder") mutate(manifest);
      });
      assert.ok(existsSync(join(f.closure.get("@kleio/coder").directory, "dist/index.js")));
      assert.ok(existsSync(join(f.closure.get("@kleio/coder").directory, "dist/index.d.ts")));
      const receipt = [...f.closure.values()].map((item) =>
        packPackage(item, f.output, tool, f.env),
      );
      assert.throws(
        () => installConsumer(receipt, f.closure, join(f.home, "consumer"), tool, f.env),
        reason,
      );
    });
});

test("hash, version and absent canonical/Pixel receipts fail before install", (t) => {
  const f = publicFixture(t);
  const receipt = [...f.closure.values()].map((item) => packPackage(item, f.output, tool, f.env));
  verifyReceipt(receipt, f.closure);
  for (const name of ["@kleio/core", "@kenkaiiii/gg-pixel"])
    assert.throws(
      () =>
        verifyReceipt(
          receipt.filter((item) => item.name !== name),
          f.closure,
        ),
      /incomplete-tarball-closure/,
    );
  assert.throws(
    () =>
      verifyReceipt(
        receipt.map((item, i) => (i === 0 ? { ...item, version: "99.0.0" } : item)),
        f.closure,
      ),
    /receipt-version/,
  );
  assert.throws(
    () =>
      verifyReceipt(
        receipt.map((item, i) => (i === 0 ? { ...item, sha256: "0".repeat(64) } : item)),
        f.closure,
      ),
    /tarball-hash-mismatch/,
  );
  const file = receipt[0].tarball;
  const original = readFileSync(file);
  writeFileSync(file, Buffer.concat([original, Buffer.from("altered")]));
  assert.throws(() => verifyReceipt(receipt, f.closure), /tarball-hash-mismatch/);
  rmSync(file);
  assert.throws(
    () => installConsumer(receipt, f.closure, join(f.home, "consumer"), tool, f.env),
    /missing-local-tarball/,
  );
  assert.equal(existsSync(join(f.home, "consumer")), false);
});

test("registry substitution, missing runtime workspace and wrong canonical versions reject", async (t) => {
  for (const [name, mutate, reason] of [
    [
      "substitution",
      (manifest) => {
        manifest.dependencies["@kenkaiiii/gg-pixel"] = "*";
      },
      /registry-workspace-substitute/,
    ],
    [
      "missing workspace",
      (manifest) => {
        manifest.dependencies["missing-workspace"] = "workspace:*";
      },
      /missing-runtime-workspace/,
    ],
    [
      "version",
      (manifest) => {
        manifest.version = "99.0.0";
      },
      /canonical-version/,
    ],
  ])
    await t.test(name, (t) => {
      const f = publicFixture(t, (name, manifest) => {
        if (name === "@kleio/coder") mutate(manifest);
      });
      assert.throws(() => workspaceClosure(f.root, tool, f.env), reason);
    });
});

test("shipped firstPrompt declaration is required by the external compiler", (t) => {
  const f = installedFixture(t, (name, manifest, files) => {
    if (name === "@kleio/coder")
      files["dist/index.d.ts"] = files["dist/index.d.ts"].replace("firstPrompt?: string;", "");
  });
  assert.throws(
    () => compileConsumer(f.consumer, compiler, f.env),
    /Property 'firstPrompt' does not exist on type 'SessionInfo'/,
  );
});

test("packed declarations cannot resolve matching checkout source outside the consumer", (t) => {
  const f = publicFixture(t);
  const source = join(f.root, "outside.ts");
  writeFileSync(source, "export interface Outside { value: string; }\n");
  const declaration = join(f.closure.get("@kleio/coder").directory, "dist/index.d.ts");
  const previous = readFileSync(declaration, "utf8");
  writeFileSync(
    declaration,
    previous +
      `\nexport type { Outside } from ${JSON.stringify((source.slice(0, -3) + ".js").replaceAll("\\", "/"))};\n`,
  );
  const receipt = [...f.closure.values()].map((item) => packPackage(item, f.output, tool, f.env));
  const consumer = join(f.home, "consumer");
  installConsumer(receipt, f.closure, consumer, tool, f.env);
  copyFileSync(
    new URL("./consumer-fixture/consumer.ts", import.meta.url),
    join(consumer, "consumer.ts"),
  );
  assert.throws(
    () => compileConsumer(consumer, compiler, f.env),
    /type-resolution-outside-consumer/,
  );
});

test("real installed bytes reuse trusted audit policy and reject extra/unknown identities", async (t) => {
  const f = installedFixture(t);
  const trusted = join(f.home, "scripts");
  mkdirSync(trusted);
  copyFileSync(
    new URL("./identity-audit.mjs", import.meta.url),
    join(trusted, "identity-audit.mjs"),
  );
  // Fixed fixture policy, not target-supplied policy or a production bypass.
  const paths = Object.fromEntries(
    Object.entries(CANONICAL_PACKAGES).map(([path, name]) => [name, path]),
  );
  const entries = [
    [paths["@kleio/core"] + "/dist/index.js", "ggcoder|ggboss", 5],
    [paths["@kleio/coder"] + "/package.json", "kenkaiiii|ggcoder", 2],
    [paths["@kleio/manager"] + "/package.json", "ggboss", 1],
  ].map(([path, regex, count], index) => ({
    id: "fixture-" + index,
    path,
    scope: "content",
    targets: ["packed"],
    match: { regex, flags: "giu" },
    expectedOccurrences: { packed: count },
    bucket: "compatibility",
    owner: "Fixture",
    reason: "Frozen fixture identifiers",
    removeWhen: "Fixture retirement",
  }));
  writeFileSync(
    join(trusted, "identity-allowlist.json"),
    JSON.stringify({ schemaVersion: 1, entries }),
  );
  const { auditInstalledPackages } = await import(
    pathToFileURL(join(trusted, "identity-audit.mjs"))
  );
  const options = {
    consumerRoot: f.consumer,
    packageRoots: Object.fromEntries(
      Object.values(CANONICAL_PACKAGES).map((name) => [name, f.installed.packageRoots[name]]),
    ),
  };
  const positive = await auditInstalledPackages(options);
  assert.equal(positive.status, "passed", JSON.stringify(positive));
  const payload = join(options.packageRoots["@kleio/core"], "dist/index.js");
  const previous = readFileSync(payload, "utf8");
  writeFileSync(payload, previous + "\n// ggcoder\n");
  const extra = await auditInstalledPackages(options);
  assert.equal(extra.countMismatches[0].actual, 6);
  writeFileSync(join(options.packageRoots["@kleio/core"], "unknown.txt"), "ggcoder");
  assert.equal((await auditInstalledPackages(options)).unclassified.length, 1);
  await assert.rejects(
    auditInstalledPackages({ ...options, allowlist: entries }),
    /invalid-audit-options/,
  );
});

test("consumer module symlinks cannot fall back to matching checkout sources", (t) => {
  const f = installedFixture(t);
  const target = join(f.consumer, "node_modules", "@kleio", "coder");
  rmSync(target, { recursive: true });
  symlinkSync(
    f.closure.get("@kleio/coder").directory,
    target,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => runtime(f), /module-outside-consumer/);
});
