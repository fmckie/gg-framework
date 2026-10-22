// Locks the host's secrets to the current user on Windows.
//
// POSIX file modes (0700/0600) do nothing on Windows: a file there gets the
// ACL its folder passes down, which under %LOCALAPPDATA% also lets SYSTEM and
// the Administrators group in. So on win32 each secret gets an ACL with
// inheritance cut off and one entry, this user with full access:
//
//   folder  icacls <path> /inheritance:r /grant:r *<SID>:(OI)(CI)F
//   file    icacls <path> /inheritance:r /grant:r *<SID>:F
//
// Files created later in a locked folder inherit its one entry. The user's SID
// comes from `whoami /user`. Both programs run by absolute path from System32,
// with an argument array and no shell (run-file.ts). An Administrator can
// still take ownership of the files; no ACL stops that.
//
// Every other platform keeps the POSIX modes, and lock() is a no-op there.

import { win32 } from "node:path";
import { err, ok, type Result } from "./result.js";
import {
  ranLine,
  runFile,
  runOptions,
  windowsSystem32,
  type RunFailure,
  type RunFile,
} from "./run-file.js";

export type LockKind = "dir" | "file";

export type AclErrorKind = "bad_path" | "whoami_failed" | "bad_sid" | "icacls_failed";

/** Our own words only: a program's output goes to the log, never in here. */
export interface AclError {
  readonly kind: AclErrorKind;
  readonly message: string;
}

export interface SecretLock {
  /** Leave the current user the only one with any access to `path`. */
  lock(path: string, kind: LockKind): Promise<Result<void, AclError>>;
}

export interface SecretLockOptions {
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Test seam; production runs the real programs. */
  readonly run?: RunFile;
  readonly log?: (msg: string) => void;
}

const ACL_TIMEOUT_MS = 10_000;
const ACL_MAX_BUFFER = 64 * 1024;
const SID = /^S-1-\d+(-\d+)+$/;

/**
 * The SID from `whoami /user /fo csv /nh` ("host\user","S-1-5-21-…"): the
 * last CSV field of the last line, kept only when it looks like a SID.
 */
export function parseWhoamiSid(stdout: string): string | null {
  const line = stdout.trim().split(/\r?\n/).pop() ?? "";
  const m = /(?:^|,)(?:"((?:[^"]|"")*)"|([^,"]*))$/.exec(line.trim());
  const field = (m?.[1]?.replace(/""/g, '"') ?? m?.[2] ?? "").trim();
  return SID.test(field) ? field : null;
}

/**
 * A path icacls can be given safely: absolute, on a drive or a share (not
 * "/…", which icacls would read as an option), with no quotes or line breaks.
 */
export function lockablePath(path: string): boolean {
  return win32.isAbsolute(path) && !path.startsWith("/") && !/["\r\n]/.test(path);
}

export function createSecretLock(options: SecretLockOptions): SecretLock {
  if (options.platform !== "win32") return { lock: () => Promise.resolve(ok(undefined)) };

  const run = options.run ?? runFile;
  const log = options.log ?? ((): void => {});
  const system32 = windowsSystem32(options.env);
  const whoami = win32.join(system32, "whoami.exe");
  const icacls = win32.join(system32, "icacls.exe");
  const opts = runOptions(ACL_TIMEOUT_MS, ACL_MAX_BUFFER);

  const failedToRun = (file: string, args: readonly string[], e: RunFailure): void => {
    log(`[acl] ${file} ${JSON.stringify(args)} ${e.kind}: ${e.message}`);
  };

  async function lookUpSid(): Promise<Result<string, AclError>> {
    const args = ["/user", "/fo", "csv", "/nh"];
    const ran = await run(whoami, args, opts);
    if (!ran.ok) {
      failedToRun(whoami, args, ran.error);
      return err({ kind: "whoami_failed", message: `whoami ${ran.error.message}` });
    }
    if (ran.value.exitCode !== 0) {
      log(ranLine("[acl]", whoami, args, ran.value));
      return err({ kind: "whoami_failed", message: `whoami exited with ${ran.value.exitCode}` });
    }
    const sid = parseWhoamiSid(ran.value.stdout);
    if (!sid) {
      log(ranLine("[acl]", whoami, args, ran.value));
      return err({ kind: "bad_sid", message: "whoami gave no user SID" });
    }
    return ok(sid);
  }

  // One lookup for the life of this lock, shared by calls made while it runs.
  // A failure isn't kept, so the next lock asks again.
  let sid: Promise<Result<string, AclError>> | undefined;
  function userSid(): Promise<Result<string, AclError>> {
    sid ??= lookUpSid().then((r) => {
      if (!r.ok) sid = undefined;
      return r;
    });
    return sid;
  }

  return {
    async lock(path, kind) {
      if (!lockablePath(path)) {
        return err({
          kind: "bad_path",
          message: "the path must be absolute, with no quotes or line breaks",
        });
      }
      const user = await userSid();
      if (!user.ok) return user;
      const grant = `*${user.value}:${kind === "dir" ? "(OI)(CI)F" : "F"}`;
      const args = [path, "/inheritance:r", "/grant:r", grant];
      const ran = await run(icacls, args, opts);
      if (!ran.ok) {
        failedToRun(icacls, args, ran.error);
        return err({ kind: "icacls_failed", message: `icacls ${ran.error.message}` });
      }
      if (ran.value.exitCode !== 0) {
        log(ranLine("[acl]", icacls, args, ran.value));
        return err({ kind: "icacls_failed", message: `icacls exited with ${ran.value.exitCode}` });
      }
      return ok(undefined);
    },
  };
}
