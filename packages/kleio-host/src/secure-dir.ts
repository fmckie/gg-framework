// The host's secrets on disk: create the state folder with its keys (`init`),
// and lock the secrets to this user before the host or the sidecar supervisor
// starts (`serve`, `sidecar`). paths.ts has the layout; acl.ts says what
// "lock" means on Windows. Elsewhere the lock is a no-op and the POSIX modes
// (0700 folder, 0600 files) do the job, as before.

import { chmod, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AclError, LockKind, SecretLock } from "./acl.js";
import { generateMasterKey } from "./file-keychain.js";
import type { HostPaths } from "./paths.js";
import { err, ok, type Result } from "./result.js";

export interface SecretLockFailure {
  readonly path: string;
  readonly error: AclError;
}

export function lockFailureMessage(f: SecretLockFailure): string {
  return `could not lock ${f.path} to this user (${f.error.kind}): ${f.error.message}`;
}

async function lockAll(
  lock: SecretLock,
  targets: readonly (readonly [string, LockKind])[],
): Promise<Result<void, SecretLockFailure>> {
  for (const [path, kind] of targets) {
    const locked = await lock.lock(path, kind);
    if (!locked.ok) return err({ path, error: locked.error });
  }
  return ok(undefined);
}

/**
 * Create `secure/` (0700) and lock it, then write any missing key (0600) inside
 * it, so a new key is never on disk unlocked, and lock each key file too. Also
 * creates the rings, work and logs folders.
 */
export async function ensureSecure(
  p: HostPaths,
  lock: SecretLock,
): Promise<Result<void, SecretLockFailure>> {
  await mkdir(p.secureDir, { recursive: true, mode: 0o700 });
  await chmod(p.secureDir, 0o700);
  const dir = await lockAll(lock, [[p.secureDir, "dir"]]);
  if (!dir.ok) return dir;
  for (const key of [p.masterKey, p.controlRootKey]) {
    try {
      await writeFile(key, generateMasterKey(), { mode: 0o600, flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    await chmod(key, 0o600);
  }
  const keys = await lockAll(lock, [
    [p.masterKey, "file"],
    [p.controlRootKey, "file"],
  ]);
  if (!keys.ok) return keys;
  for (const d of [p.rings, p.work, p.logs]) await mkdir(d, { recursive: true });
  return ok(undefined);
}

async function entryKind(path: string): Promise<"dir" | "file" | "other" | null> {
  try {
    const s = await lstat(path);
    return s.isDirectory() ? "dir" : s.isFile() ? "file" : "other";
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Lock every secret that exists: `secure/` and each file in it (master key,
 * control root, admin.token, device registry), and the API key files and
 * sidecar.json beside it. This repairs an ACL that has drifted and covers
 * files written before the host locked them. Missing ones are skipped (the
 * supervisor can start before `init`); symlinks are left alone.
 */
export async function lockSecrets(
  p: HostPaths,
  lock: SecretLock,
): Promise<Result<void, SecretLockFailure>> {
  const targets: [string, LockKind][] = [];
  if ((await entryKind(p.secureDir)) === "dir") {
    targets.push([p.secureDir, "dir"]);
    const names = (await readdir(p.secureDir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
    for (const name of names) targets.push([join(p.secureDir, name), "file"]);
  }
  for (const file of [p.composioKey, p.typesafeKey, p.openaiKey, p.sidecarEndpoint]) {
    if ((await entryKind(file)) === "file") targets.push([file, "file"]);
  }
  return lockAll(lock, targets);
}
