// Bump the gg-app version across EVERY place that must stay in lockstep, so the
// Mac and the iPhone always show the same version and a release never ships
// with mismatched ones:
//   1. gg-app/package.json            "version"
//   2. gg-app/src-tauri/tauri.conf.json  "version"  (the bundle/updater version)
//   3. gg-app/src-tauri/Cargo.toml    [package] version
//   4. gg-app/src-tauri/Cargo.lock    the gg-app package entry
//   5. gg-app/src-tauri/tauri.ios.conf.json  "version" + iOS "bundleVersion"
//   6. gg-app/src-tauri/gen/apple/project.yml  the app's and the widget's
//      CFBundleShortVersionString + CFBundleVersion
//   7. gg-app/src-tauri/gen/apple/{gg-app_iOS,KleioWidgets}/Info.plist  the same
// The iPhone build number (CFBundleVersion) goes up by one with every bump; the
// widget's must equal the app's. scripts/version-alignment.test.mjs checks it.
//
// Usage:
//   node scripts/bump-version.mjs patch        # 0.1.40 -> 0.1.41
//   node scripts/bump-version.mjs minor        # 0.1.40 -> 0.2.0
//   node scripts/bump-version.mjs major        # 0.1.40 -> 1.0.0
//   node scripts/bump-version.mjs 0.1.42       # explicit version
//
// Prints the new version to stdout on success (so a caller can capture it).
// Does NOT git-add/commit/tag — that's the release command's job.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const pkgPath = join(appRoot, "package.json");
const confPath = join(appRoot, "src-tauri", "tauri.conf.json");
const cargoPath = join(appRoot, "src-tauri", "Cargo.toml");
const lockPath = join(appRoot, "src-tauri", "Cargo.lock");
const iosConfPath = join(appRoot, "src-tauri", "tauri.ios.conf.json");
const appleDir = join(appRoot, "src-tauri", "gen", "apple");
const projectYmlPath = join(appleDir, "project.yml");
const plistPaths = [
  join(appleDir, "gg-app_iOS", "Info.plist"),
  join(appleDir, "KleioWidgets", "Info.plist"),
];

const SEMVER = /^\d+\.\d+\.\d+$/;

function fail(msg) {
  console.error(`bump-version: ${msg}`);
  process.exit(1);
}

function nextVersion(current, arg) {
  if (SEMVER.test(arg)) return arg;
  const [major, minor, patch] = current.split(".").map(Number);
  if (arg === "major") return `${major + 1}.0.0`;
  if (arg === "minor") return `${major}.${minor + 1}.0`;
  if (arg === "patch") return `${major}.${minor}.${patch + 1}`;
  fail(`unknown bump "${arg}" — use patch | minor | major | x.y.z`);
}

const arg = process.argv[2];
if (!arg) fail("missing argument — use patch | minor | major | x.y.z");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
if (!SEMVER.test(current)) fail(`current package.json version "${current}" is not x.y.z`);

const next = nextVersion(current, arg);
if (next === current) fail(`new version equals current (${current}) — nothing to do`);

// Read and check the iPhone files before writing anything, so a missing field
// fails the bump up front instead of leaving the Mac and the iPhone apart.
const iosRaw = readFileSync(iosConfPath, "utf8");
const build = Number(JSON.parse(iosRaw).bundle?.iOS?.bundleVersion);
if (!Number.isInteger(build) || build < 1)
  fail("tauri.ios.conf.json has no whole-number bundle.iOS.bundleVersion");
const nextBuild = String(build + 1);

/** `re` must match exactly `times` times in `raw` (a /g regex). */
function replaceAll(raw, re, replacement, times, what) {
  const found = raw.match(re)?.length ?? 0;
  if (found !== times) fail(`expected ${times} ${what}, found ${found}`);
  return raw.replace(re, replacement);
}

const iosNext = replaceAll(
  replaceAll(
    iosRaw,
    /("version":\s*")\d+\.\d+\.\d+(")/g,
    (_m, a, b) => `${a}${next}${b}`,
    1,
    "version in tauri.ios.conf.json",
  ),
  /("bundleVersion":\s*")\d+(")/g,
  (_m, a, b) => `${a}${nextBuild}${b}`,
  1,
  "bundleVersion in tauri.ios.conf.json",
);
const ymlNext = replaceAll(
  replaceAll(
    readFileSync(projectYmlPath, "utf8"),
    /^(\s+CFBundleShortVersionString: )\S+$/gm,
    (_m, a) => `${a}${next}`,
    2,
    "CFBundleShortVersionString lines in project.yml (app + widget)",
  ),
  /^(\s+CFBundleVersion: )\S+$/gm,
  (_m, a) => `${a}"${nextBuild}"`,
  2,
  "CFBundleVersion lines in project.yml (app + widget)",
);
const plistsNext = plistPaths.map((path) =>
  replaceAll(
    replaceAll(
      readFileSync(path, "utf8"),
      /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/g,
      (_m, a, b) => `${a}${next}${b}`,
      1,
      `CFBundleShortVersionString in ${path}`,
    ),
    /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/g,
    (_m, a, b) => `${a}${nextBuild}${b}`,
    1,
    `CFBundleVersion in ${path}`,
  ),
);

// 1. package.json (keep 2-space JSON + trailing newline, matching the repo).
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 2. tauri.conf.json — bump ONLY the top-level "version" key (string-targeted so
// nested versions like the schema URL are untouched).
const confRaw = readFileSync(confPath, "utf8");
const confNext = confRaw.replace(
  /("version":\s*")\d+\.\d+\.\d+(")/,
  (_m, a, b) => `${a}${next}${b}`,
);
if (confNext === confRaw) fail("could not find a version field in tauri.conf.json");
writeFileSync(confPath, confNext);

// 3. Cargo.toml — the [package] version line (first `version = "x.y.z"`).
const cargoRaw = readFileSync(cargoPath, "utf8");
const cargoNext = cargoRaw.replace(/^version = "\d+\.\d+\.\d+"/m, `version = "${next}"`);
if (cargoNext === cargoRaw) fail("could not find the [package] version in Cargo.toml");
writeFileSync(cargoPath, cargoNext);

// 4. Cargo.lock — the gg-app entry only (anchored to the name line so other
// packages that happen to share the old version are not touched).
const lockRaw = readFileSync(lockPath, "utf8");
const lockNext = lockRaw.replace(
  /(name = "gg-app"\nversion = ")\d+\.\d+\.\d+(")/,
  (_m, a, b) => `${a}${next}${b}`,
);
if (lockNext === lockRaw) fail("could not find the gg-app entry in Cargo.lock");
writeFileSync(lockPath, lockNext);

// 5–7. The iPhone app and its widget: same version, next build number.
writeFileSync(iosConfPath, iosNext);
writeFileSync(projectYmlPath, ymlNext);
plistPaths.forEach((path, i) => writeFileSync(path, plistsNext[i]));

console.error(
  `bump-version: ${current} -> ${next}, iPhone build ${build} -> ${nextBuild} ` +
    "(package.json, tauri.conf.json, Cargo.toml, Cargo.lock, tauri.ios.conf.json, " +
    "project.yml, Info.plists)",
);
process.stdout.write(next + "\n");
