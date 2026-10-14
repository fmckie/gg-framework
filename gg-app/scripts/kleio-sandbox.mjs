/**
 * Sandbox helpers for scripts that run the real Kleio host and sidecar on this
 * machine (dev-host.mjs): a spare loopback port, the environment the host and
 * sidecar run with, the guard that keeps every path they write inside one
 * throwaway folder, and a fingerprint of the real Kleio folders to compare
 * before and after. For `dev-host.mjs --app`, also the desktop app's
 * environment, its guard, and the guard on the sandbox's own keychain path.
 *
 * Adapted from the helpers in e2e-dictation-setup.mjs, which keeps its own.
 */
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/** Every env key that names a folder or file the host or sidecar writes. */
export const SANDBOX_PATH_KEYS = Object.freeze([
  "HOME",
  "USERPROFILE",
  "KLEIO_HOST_HOME",
  "KLEIO_HOME_CWD",
  "KLEIO_PROJECTS_DIR",
  "KLEIO_SETTINGS_FILE",
  "KLEIO_SIDECAR_CWD",
]);

/** The only KLEIO_* settings a sandbox runs with: the ones sandboxEnv sets. */
const SANDBOX_KLEIO_KEYS = Object.freeze([
  ...SANDBOX_PATH_KEYS.filter((key) => key.startsWith("KLEIO_")),
  "KLEIO_HOST_PORT",
  "KLEIO_PUBLIC_URL",
  "KLEIO_PREVIEW_PORT",
  "KLEIO_SIDECAR_PATH",
  "KLEIO_NODE_BIN",
]);

/**
 * Every env key that places the desktop app's home: HOME (~/.kleio, the
 * Keychain's search list and default keychain, and the Library folders the
 * app's Rust resolves), USERPROFILE (as sandboxEnv sets it), and
 * CFFIXED_USER_HOME (NSHomeDirectory(), so the webview's storage).
 */
export const APP_HOME_KEYS = Object.freeze(["HOME", "USERPROFILE", "CFFIXED_USER_HOME"]);

/**
 * Settings of the calling shell that never reach the sandbox: its own Kleio
 * settings (keys, URLs, folders), every GG_* (the sidecar's own folders and
 * diagnostics among them), NODE_OPTIONS (preloads), and its home.
 */
function fromShellOnly(key) {
  const upper = key.toUpperCase();
  return (
    upper.startsWith("KLEIO_") ||
    upper.startsWith("GG_") ||
    upper === "NODE_OPTIONS" ||
    SANDBOX_PATH_KEYS.includes(upper)
  );
}

/** A port nothing listens on right now, on 127.0.0.1. */
export function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => done(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** Two different spare loopback ports: the API's and the site previews'. */
export async function freePorts() {
  const api = await freePort();
  for (let tries = 0; tries < 10; tries += 1) {
    const preview = await freePort();
    if (preview !== api) return { api, preview };
  }
  throw new Error("could not find two spare loopback ports");
}

/**
 * The path as the filesystem resolves it: the longest part that exists goes
 * through realpath (symlinks resolved; on macOS and Windows, the case on disk),
 * and the rest is appended. So a folder that isn't there yet, under a symlink
 * into the real home, still resolves to the real home.
 */
export function canonicalPath(p) {
  const missing = [];
  let current = resolve(p);
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(p);
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/** The comparison form: canonical and lower-cased (APFS and NTFS ignore case). */
const comparable = (p) => canonicalPath(p).toLowerCase();

/** True when `inner` is `outer` or inside it. Both in comparable form. */
function within(inner, outer) {
  return inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
}

/**
 * The real folders a sandbox must stay out of, for the given real home. Each
 * is checked on its own as well as through the home, since any of them may
 * be a symlink to somewhere outside it.
 */
export function protectedPaths(realHome) {
  return {
    "~/.gg": join(realHome, ".gg"),
    "~/.kleio": join(realHome, ".kleio"),
    // The host's default state folder (packages/kleio-host/src/paths.ts).
    "host state folder": join(realHome, "Library", "Application Support", "Kleio", "host"),
  };
}

/** Why `path` would touch the real home or one of its Kleio folders; null when clear. */
function realHomeClash(path, realHome) {
  const target = comparable(path);
  const home = comparable(realHome);
  if (target === home) return "is the real home";
  for (const [name, real] of Object.entries(protectedPaths(realHome))) {
    const folder = comparable(real);
    if (target === folder) return `is the real ${name}`;
    if (within(target, folder)) return `is inside the real ${name}`;
    if (within(folder, target)) return `contains the real ${name}`;
  }
  if (within(target, home)) return "is inside the real home";
  if (within(home, target)) return "contains the real home";
  return null;
}

const isPort = (value) =>
  /^\d{1,5}$/.test(value ?? "") && Number(value) >= 1 && Number(value) <= 65535;

/**
 * The sandbox folder, then each of `keys` in `env`: set, a plain absolute
 * path, clear of the real home and its Kleio folders, and inside `sandbox`.
 */
function pathProblems({ keys, sandbox, env, realHome }) {
  const problems = [];
  const sandboxClash = realHomeClash(sandbox, realHome);
  if (sandboxClash) problems.push(`the sandbox ${sandbox} ${sandboxClash}`);
  const box = comparable(sandbox);
  for (const key of keys) {
    const value = env[key];
    if (!value) {
      problems.push(`${key} is not set`);
      continue;
    }
    if (!isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
      problems.push(`${key}=${value} is not a plain absolute path`);
      continue;
    }
    const clash = realHomeClash(value, realHome);
    if (clash) problems.push(`${key}=${value} ${clash}`);
    else if (!within(comparable(value), box)) {
      problems.push(`${key}=${value} is not inside the sandbox ${sandbox}`);
    }
  }
  return problems;
}

/** Each KLEIO_* key not in `allowed`, each GG_* key and NODE_OPTIONS, in sorted order. */
function outsideKeyProblems(env, allowed) {
  return Object.keys(env)
    .sort()
    .filter((key) => {
      const upper = key.toUpperCase();
      return (
        (upper.startsWith("KLEIO_") && !allowed.includes(key)) ||
        upper.startsWith("GG_") ||
        upper === "NODE_OPTIONS"
      );
    })
    .map((key) => `${key} comes from outside the sandbox`);
}

/**
 * Why the host and sidecar must not run with `env`, or [] when they may.
 *
 * - The sandbox folder, and every path in SANDBOX_PATH_KEYS, may not be, contain
 *   or sit inside the real home, ~/.gg, ~/.kleio or host state folder. Real
 *   paths (symlinks resolved), ignoring case.
 * - Each of those paths must be set, absolute, free of "..", and inside the
 *   sandbox.
 * - The host's public URL must be http://127.0.0.1:<its port>: loopback HTTP.
 * - No KLEIO_* setting beyond the sandbox's own, no GG_*, no NODE_OPTIONS.
 *
 * `realHome` is an argument, not os.homedir(), so tests can use temp folders.
 */
export function sandboxProblems({ sandbox, env, realHome }) {
  const problems = pathProblems({ keys: SANDBOX_PATH_KEYS, sandbox, env, realHome });
  const port = env.KLEIO_HOST_PORT;
  if (!isPort(port)) problems.push(`KLEIO_HOST_PORT=${port} is not a port`);
  if (!isPort(env.KLEIO_PREVIEW_PORT) || env.KLEIO_PREVIEW_PORT === port) {
    problems.push(`KLEIO_PREVIEW_PORT=${env.KLEIO_PREVIEW_PORT} is not a second port`);
  }
  if (env.KLEIO_PUBLIC_URL !== `http://127.0.0.1:${port}`) {
    problems.push(`KLEIO_PUBLIC_URL=${env.KLEIO_PUBLIC_URL} is not http://127.0.0.1:${port}`);
  }
  problems.push(...outsideKeyProblems(env, SANDBOX_KLEIO_KEYS));
  return problems;
}

/**
 * Why the desktop app must not run with `env`, or [] when it may: the same
 * folder checks as sandboxProblems for every key in APP_HOME_KEYS, and no
 * KLEIO_* setting at all (KLEIO_HOST_URL with a token would skip pairing,
 * and the rest name real folders), no GG_*, no NODE_OPTIONS.
 */
export function appEnvProblems({ sandbox, env, realHome }) {
  return [
    ...pathProblems({ keys: APP_HOME_KEYS, sandbox, env, realHome }),
    ...outsideKeyProblems(env, []),
  ];
}

/**
 * The desktop app's environment: this shell's, minus anything in
 * fromShellOnly and any CFFIXED_USER_HOME, plus every APP_HOME_KEYS key set
 * to `<sandbox>/home`. So the app starts unpaired, as a new user, with no
 * env-mode host.
 */
export function appEnv({ sandbox, baseEnv }) {
  const home = join(sandbox, "home");
  const inherited = Object.fromEntries(
    Object.entries(baseEnv).filter(
      ([key]) => !fromShellOnly(key) && !APP_HOME_KEYS.includes(key.toUpperCase()),
    ),
  );
  return { ...inherited, ...Object.fromEntries(APP_HOME_KEYS.map((key) => [key, home])) };
}

/**
 * Why `path` must not be handed to `security` as the sandbox's own keychain,
 * or [] when it may. It must be a plain absolute path that is already its
 * real path (realpath finds no symlink along it), strictly inside
 * `sandboxHome`, and clear of the real home and its Kleio folders. The login
 * keychain lives in the real home, so it can never pass.
 */
export function keychainPathProblems({ path, sandboxHome, realHome }) {
  if (!isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    return [`the keychain ${path} is not a plain absolute path`];
  }
  const problems = [];
  const real = canonicalPath(path);
  if (real !== path) problems.push(`the keychain ${path} is not its real path ${real}`);
  const clash = realHomeClash(path, realHome);
  if (clash) problems.push(`the keychain ${path} ${clash}`);
  const target = comparable(path);
  const home = comparable(sandboxHome);
  if (target === home || !within(target, home)) {
    problems.push(`the keychain ${path} is not inside the sandbox home ${sandboxHome}`);
  }
  return problems;
}

/**
 * The host's and sidecar's environment: this shell's, minus anything in
 * fromShellOnly, plus a home, state folder, Kleio folder, projects folder,
 * settings file and working folder inside `sandbox`, and two loopback ports.
 */
export function sandboxEnv({ sandbox, baseEnv, apiPort, previewPort, sidecarPath, nodeBin }) {
  const home = join(sandbox, "home");
  const inherited = Object.fromEntries(
    Object.entries(baseEnv).filter(([key]) => !fromShellOnly(key)),
  );
  return {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    KLEIO_HOST_HOME: join(sandbox, "host"),
    KLEIO_HOST_PORT: String(apiPort),
    KLEIO_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
    KLEIO_PREVIEW_PORT: String(previewPort),
    KLEIO_HOME_CWD: join(sandbox, "Kleio"),
    KLEIO_PROJECTS_DIR: join(sandbox, "projects"),
    KLEIO_SETTINGS_FILE: join(home, ".gg", "kleio-app.json"),
    KLEIO_SIDECAR_PATH: sidecarPath,
    KLEIO_NODE_BIN: nodeBin,
    KLEIO_SIDECAR_CWD: join(sandbox, "work"),
  };
}

const describe = (stats) =>
  `${stats.isDirectory() ? "dir" : stats.size}:${Math.round(stats.mtimeMs)}`;

/**
 * Every entry under `dir` (and `dir` itself, as "."), with its size and mtime,
 * in sorted order; { ".": "absent" } when `dir` doesn't exist. Names, sizes
 * and mtimes only: nothing is read.
 */
export function fingerprint(dir) {
  let root;
  try {
    root = statSync(dir);
  } catch {
    return new Map([[".", "absent"]]);
  }
  const entries = [[".", describe(root)]];
  if (root.isDirectory()) {
    for (const rel of readdirSync(dir, { recursive: true }).map(String).sort()) {
      try {
        entries.push([rel, describe(lstatSync(join(dir, rel)))]);
      } catch {
        entries.push([rel, "gone"]);
      }
    }
  }
  return new Map(entries);
}

/** What differs between two fingerprints, by relative path, sorted. */
export function fingerprintChanges(before, after) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.flatMap((path) => {
    const was = before.get(path);
    const now = after.get(path);
    if (was === now) return [];
    const change = was === undefined ? "added" : now === undefined ? "removed" : "changed";
    return [{ path, change }];
  });
}
