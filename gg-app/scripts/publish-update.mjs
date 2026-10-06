// Publish a Kleio update for the Mac. Installed copies check for one at launch
// and every hour (src/update.ts); when this one appears, the banner along the
// bottom of the app says "Kleio just got an update!", and a click downloads it,
// installs it and restarts Kleio.
//
//   pnpm --filter gg-app bump patch              # every version field, Mac + iPhone
//   git commit + push
//   pnpm --filter gg-app run publish:update      # build, sign, verify, publish
//
// It builds the signed Mac app for the version in package.json with its update
// bundle (Kleio.app.tar.gz + .sig, signed with the updater key), checks that
// the signature verifies against the public key the app trusts
// (plugins.updater.pubkey in src-tauri/tauri.conf.json), writes latest.json and
// publishes the three as the GitHub release kleio-v<version> on the repo the
// updater polls. Not a v* tag: those start Ken's release workflow
// (.github/workflows/release.yml).
//
// The updater key is ~/.tauri/kleio-updater.key (or $KLEIO_UPDATER_KEY), its
// password in the login keychain under the service "kleio-updater" (or
// $KLEIO_UPDATER_KEY_PASSWORD). Keep a backup of both: without them no update
// can be signed, and every installed copy would have to be reinstalled by hand.
//
// The iPhone can't update itself like this (an iOS app only updates through the
// App Store or TestFlight); it is installed from Xcode as before.
//
// --dry-run: build, verify and write latest.json, but publish nothing.
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "..");
const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  console.error(`publish-update: ${message}`);
  process.exit(1);
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const output = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const succeeds = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

if (process.platform !== "darwin") fail("run this on the Mac");
const platformKey = { arm64: "darwin-aarch64", x64: "darwin-x86_64" }[process.arch];
if (!platformKey) fail(`no updater platform for this Mac's ${process.arch} processor`);

const version = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")).version;
const conf = JSON.parse(readFileSync(join(appRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const endpoint = conf.plugins?.updater?.endpoints?.[0] ?? "";
const slug = endpoint.match(
  /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\/latest\/download\/latest\.json$/,
)?.[1];
if (!slug) fail(`the updater endpoint is not a GitHub latest-release URL: ${endpoint}`);
const tag = `kleio-v${version}`;

// Every version field must agree, or the Mac and the iPhone drift apart again.
run("pnpm", ["exec", "vitest", "run", "scripts/version-alignment.test.mjs"], { cwd: appRoot });

const head = output("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
if (!dryRun) {
  if (output("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repoRoot }))
    fail("commit your changes first: the release must be built from a pushed commit");
  run("git", ["fetch", "--quiet", "origin"], { cwd: repoRoot });
  if (!output("git", ["branch", "-r", "--contains", head], { cwd: repoRoot }))
    fail("push this commit first: the release's tag points at it");
  if (succeeds("gh", ["release", "view", tag, "-R", slug]))
    fail(`${tag} is already published; bump the version first (pnpm --filter gg-app bump patch)`);
}

const keyPath = process.env.KLEIO_UPDATER_KEY ?? join(homedir(), ".tauri", "kleio-updater.key");
if (!existsSync(keyPath)) fail(`no updater key at ${keyPath}`);
let password = process.env.KLEIO_UPDATER_KEY_PASSWORD;
if (password === undefined) {
  try {
    password = output("security", ["find-generic-password", "-s", "kleio-updater", "-w"]);
  } catch {
    fail('no updater key password: none in the keychain under "kleio-updater"');
  }
}
let identity = process.env.APPLE_SIGNING_IDENTITY;
if (!identity) {
  const identities = output("security", ["find-identity", "-v", "-p", "codesigning"]);
  identity = identities.match(/"(Developer ID Application: [^"]+)"/)?.[1];
  if (!identity) fail("no Developer ID Application signing identity in the keychain");
}

// The sidecar the app ships: ggcoder and what it builds on, bundled with the
// Node runtime, smoke-tested, then signed so the app's signature holds.
run("pnpm", ["--filter", "@kleio/coder...", "build"], { cwd: repoRoot });
run("pnpm", ["stage:node"], { cwd: appRoot });
run("pnpm", ["bundle:sidecar"], { cwd: appRoot });
run("node", [join(appRoot, "scripts", "smoke-sidecar.mjs")]);
run("bash", [
  join(appRoot, "scripts", "sign-nested-macos.sh"),
  identity,
  join(appRoot, "src-tauri", "binaries"),
  join(appRoot, "src-tauri", "sidecar"),
]);
// tauri.conf.json has bundle.createUpdaterArtifacts on: with the key in the
// environment, the build also writes the signed update bundle.
run("pnpm", ["exec", "tauri", "build", "--bundles", "app"], {
  cwd: appRoot,
  env: {
    ...process.env,
    APPLE_SIGNING_IDENTITY: identity,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, "utf8"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  },
});

const bundleDir = join(appRoot, "src-tauri", "target", "release", "bundle", "macos");
const appPath = join(bundleDir, `${conf.productName}.app`);
const tarPath = `${appPath}.tar.gz`;
const sigPath = `${tarPath}.sig`;
const latestPath = join(bundleDir, "latest.json");
for (const path of [appPath, tarPath, sigPath])
  if (!existsSync(path)) fail(`the build left no ${basename(path)}`);
run("codesign", ["--verify", "--deep", "--strict", appPath]);

// Check the update the way the installed app will (minisign over Ed25519), so
// a wrong key fails here rather than in everyone's banner.
const minisign = (b64) => Buffer.from(b64.trim(), "base64").toString("utf8").split("\n");
const pubLines = minisign(conf.plugins.updater.pubkey);
const sigText = readFileSync(sigPath, "utf8").trim();
const sigLines = minisign(sigText);
const pub = Buffer.from(pubLines[1] ?? "", "base64"); // "Ed", key id (8), key (32)
const sig = Buffer.from(sigLines[1] ?? "", "base64"); // "Ed"/"ED", key id (8), signature (64)
if (pub.length !== 42 || sig.length !== 74) fail("the update's signature or public key is malformed");
if (!sig.subarray(2, 10).equals(pub.subarray(2, 10)))
  fail("the update is signed with a different key than the one tauri.conf.json trusts");
const publicKey = createPublicKey({
  key: { kty: "OKP", crv: "Ed25519", x: pub.subarray(10).toString("base64url") },
  format: "jwk",
});
const data = readFileSync(tarPath);
const prehashed = sig.subarray(0, 2).toString("latin1") === "ED";
const signed = prehashed ? createHash("blake2b512").update(data).digest() : data;
const signature = sig.subarray(10);
const trusted = (sigLines[2] ?? "").replace(/^trusted comment: /, "");
const globalSignature = Buffer.from(sigLines[3] ?? "", "base64");
if (
  !verify(null, signed, publicKey, signature) ||
  !verify(null, Buffer.concat([signature, Buffer.from(trusted)]), publicKey, globalSignature)
)
  fail("the update's signature does not verify against the key tauri.conf.json trusts");

const latest = {
  version,
  notes: `Kleio ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    [platformKey]: {
      signature: sigText,
      url: `https://github.com/${slug}/releases/download/${tag}/${basename(tarPath)}`,
    },
  },
};
writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

if (dryRun) {
  console.error(
    `publish-update: dry run done. Kleio ${version} built, signed and verified; nothing published.\n` +
      `  ${appPath}\n  ${tarPath}\n  ${latestPath}`,
  );
  process.exit(0);
}

// A draft first, so the release is only visible once all three files are up.
run("gh", [
  "release",
  "create",
  tag,
  "-R",
  slug,
  "--draft",
  "--target",
  head,
  "--title",
  `Kleio ${version}`,
  "--notes",
  `Kleio ${version} for the Mac. Installed copies offer it in the banner at the bottom of the app.`,
  tarPath,
  sigPath,
  latestPath,
]);
run("gh", ["release", "edit", tag, "-R", slug, "--draft=false", "--latest"]);
console.error(
  `publish-update: published ${tag}. Installed copies of Kleio show the update banner ` +
    "at their next launch, or within the hour.",
);
