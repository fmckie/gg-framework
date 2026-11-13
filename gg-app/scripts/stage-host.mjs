// Stage the Kleio host into src-tauri/host/, a bundle resource of the Mac app
// only (src-tauri/tauri.macos.conf.json). "On this Mac" installs it from there
// with install-mini.sh in app mode (KLEIO_HOST_MODE=app). Node and the engine
// aren't staged again: the app already ships them (binaries/ggnode, sidecar/).
//
//   node scripts/stage-host.mjs [--link-bin <path>] [--no-capture]
//
// On a Mac it builds @kleio/host, its page and PDF capture helper
// (build-capture.sh, needs Xcode) and kleio-link-host (cargo, release), then
// stages:
//   host/dist/{cli.js,index.js,chunk-*.js}   no source maps, no .d.ts
//   host/dist/bin/kleio-capture
//   host/bin/kleio-link-host
//   host/install-mini.sh
//   host/package.json                        { "type": "module" }
//   host/VERSION                             <app version>+<commit>
//
//   --link-bin <path>  stage this kleio-link-host instead of building one (CI
//                      stages the debug build `cargo test --features host` made)
//   --no-capture       leave the capture helper out (CI has no Xcode). Voice
//                      shows of pages and PDFs fail on such a build: never for
//                      a release.
//
// Elsewhere it says it skipped and exits 0: only the Mac app carries a host.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(appRoot, "..");
const hostPackage = join(repoRoot, "packages", "kleio-host");
const linkManifest = join(repoRoot, "packages", "kleio-link", "Cargo.toml");
export const HOST_OUT = join(appRoot, "src-tauri", "host");

/** `--link-bin <path>` and `--no-capture`; anything else is a mistake. */
export function parseArgs(argv) {
  const options = { linkBin: undefined, capture: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-capture") options.capture = false;
    else if (arg === "--link-bin" && argv[i + 1] && !argv[i + 1].startsWith("--"))
      options.linkBin = resolve(argv[++i]);
    else throw new Error(`stage-host: unknown or incomplete option ${arg}`);
  }
  return options;
}

/** `<app version>+<commit>`: also the name of the installed code's folder. */
export function hostVersion(version, commit) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`stage-host: the app version must be x.y.z, not ${JSON.stringify(version)}`);
  if (!/^[0-9a-f]{8,40}$/.test(commit))
    throw new Error(`stage-host: the commit must be a git hash, not ${JSON.stringify(commit)}`);
  return `${version}+${commit}`;
}

/**
 * Copy the built host into `outDir`, replacing what was there. It's put
 * together beside `outDir` and renamed into place, so a failure leaves no
 * half-staged folder for the app build to pick up.
 */
export function stageHost({ hostDir, linkBin, outDir, version, capture = true }) {
  const dist = join(hostDir, "dist");
  const installer = join(hostDir, "scripts", "install-mini.sh");
  const helper = join(dist, "bin", "kleio-capture");
  const missing = (path, how) => new Error(`stage-host: missing ${path} (${how})`);
  if (!existsSync(join(dist, "cli.js")))
    throw missing(join(dist, "cli.js"), "pnpm --filter @kleio/host build");
  if (!existsSync(installer)) throw missing(installer, "it's in the repo");
  if (!linkBin || !existsSync(linkBin))
    throw missing(linkBin ?? "kleio-link-host", "build it with cargo, or pass --link-bin");
  if (capture && !existsSync(helper))
    throw missing(helper, "sh packages/kleio-host/scripts/build-capture.sh, or pass --no-capture");

  const partial = `${outDir}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(join(partial, "dist"), { recursive: true });
  mkdirSync(join(partial, "bin"));
  for (const name of readdirSync(dist)) {
    if (name.endsWith(".js")) copyFileSync(join(dist, name), join(partial, "dist", name));
  }
  if (capture) {
    mkdirSync(join(partial, "dist", "bin"));
    copyFileSync(helper, join(partial, "dist", "bin", "kleio-capture"));
    chmodSync(join(partial, "dist", "bin", "kleio-capture"), 0o755);
  }
  copyFileSync(linkBin, join(partial, "bin", "kleio-link-host"));
  chmodSync(join(partial, "bin", "kleio-link-host"), 0o755);
  copyFileSync(installer, join(partial, "install-mini.sh"));
  writeFileSync(join(partial, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(partial, "VERSION"), `${version}\n`);
  rmSync(outDir, { recursive: true, force: true });
  renameSync(partial, outDir);
  return outDir;
}

function main() {
  if (process.platform !== "darwin") {
    console.log("stage-host: skipped: only the Mac app carries a host");
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
  run("pnpm", ["--filter", "@kleio/host", "build"]);
  // After the host build: it empties dist/, where the helper goes.
  if (options.capture) run("sh", [join(hostPackage, "scripts", "build-capture.sh")]);
  let linkBin = options.linkBin;
  if (!linkBin) {
    const triple = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
    // As deploy-mini.sh builds it for the mini.
    run("cargo", [
      "build",
      "--release",
      "--locked",
      "--features",
      "host",
      "--bin",
      "kleio-link-host",
      "--target",
      triple,
      "--manifest-path",
      linkManifest,
    ]);
    const target =
      process.env.CARGO_TARGET_DIR || join(repoRoot, "packages", "kleio-link", "target");
    linkBin = join(resolve(repoRoot, target), triple, "release", "kleio-link-host");
  }
  const appVersion = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")).version;
  const commit = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const version = hostVersion(appVersion, commit);
  stageHost({ hostDir: hostPackage, linkBin, outDir: HOST_OUT, version, capture: options.capture });
  console.log(
    `staged the host ${version}: ${HOST_OUT}` +
      (options.capture ? "" : " (no capture helper: not for a release)"),
  );
}

// Run only when executed directly, so tests can import the helpers.
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
