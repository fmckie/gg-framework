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
// That keeps any entry given to the path itself rather than passed down: the
// ones Windows writes when the folder above passes nothing down (SYSTEM and
// the Administrators group, say), or one someone added. So the lock then reads
// the ACL back (icacls <path> /save, into a new temporary folder), removes
// every other account's entries (icacls <path> /remove *<SID>), and reads it
// again. Unless it is then this user's alone, with inheritance cut off, the
// lock fails; so does one whose ACL can't be read back.
//
// Files created later in a locked folder inherit its one entry. The user's SID
// comes from `whoami /user`. Both programs run by absolute path from System32,
// with an argument array and no shell (run-file.ts). An Administrator can
// still take ownership of the files; no ACL stops that.
//
// Every other platform keeps the POSIX modes, and lock() is a no-op there.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { err, ok, type Result } from "./result.js";
import {
  logText,
  ranLine,
  runFile,
  runOptions,
  windowsSystem32,
  type RunFailure,
  type RunFile,
} from "./run-file.js";

export type LockKind = "dir" | "file";

export type AclErrorKind =
  "bad_path" | "whoami_failed" | "bad_sid" | "icacls_failed" | "unreadable" | "not_private";

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

/** One entry of a DACL, as SDDL writes it: type "A" allows, "D" denies. */
export interface Ace {
  readonly type: string;
  readonly flags: string;
  readonly rights: string;
  readonly sid: string;
}

export interface Dacl {
  /** "P" when inheritance is cut off, beside "AI" and "AR". */
  readonly flags: string;
  readonly aces: readonly Ace[];
}

const ACL_TIMEOUT_MS = 10_000;
const ACL_MAX_BUFFER = 64 * 1024;
const SID = /^S-1-\d+(-\d+)+$/;
/** Full access: SDDL's "FA", or its mask spelled out. */
const FULL_ACCESS = /^(FA|0x1f01ff)$/i;

/**
 * SDDL's names for the well-known SIDs that are the same on every machine, so
 * an entry for one can be removed by its SID. A name that depends on the
 * domain ("DA", say) isn't here: its entry stays, and the lock fails.
 */
const WELL_KNOWN_SIDS: ReadonlyMap<string, string> = new Map([
  ["AC", "S-1-15-2-1"],
  ["AN", "S-1-5-7"],
  ["AU", "S-1-5-11"],
  ["BA", "S-1-5-32-544"],
  ["BG", "S-1-5-32-546"],
  ["BU", "S-1-5-32-545"],
  ["CG", "S-1-3-1"],
  ["CO", "S-1-3-0"],
  ["IU", "S-1-5-4"],
  ["LS", "S-1-5-19"],
  ["NS", "S-1-5-20"],
  ["NU", "S-1-5-2"],
  ["OW", "S-1-3-4"],
  ["PU", "S-1-5-32-547"],
  ["RC", "S-1-5-12"],
  ["SU", "S-1-5-6"],
  ["SY", "S-1-5-18"],
  ["WD", "S-1-1-0"],
  ["WR", "S-1-5-33"],
]);

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

/**
 * The DACL in what `icacls <path> /save` writes for one path: UTF-16LE, its
 * name on one line, then its SDDL. Null unless there is exactly one "D:" line
 * and it reads to its end as plain entries, so an entry this can't read (a
 * conditional one, say) is never skipped over.
 */
export function parseSavedDacl(saved: Buffer): Dacl | null {
  const lines = saved
    .toString("utf16le")
    .replace(/^\uFEFF/, "")
    .replaceAll("\u0000", "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("D:"));
  const m =
    lines.length === 1 ? /^D:([A-Z]*)((?:\([^()]*\))*)(?:S:.*)?\s*$/.exec(lines[0] ?? "") : null;
  if (!m) return null;
  const aces: Ace[] = [];
  for (const entry of (m[2] ?? "").matchAll(/\(([^()]*)\)/g)) {
    const fields = (entry[1] ?? "").split(";");
    if (fields.length !== 6) return null;
    const [type = "", flags = "", rights = "", , , sid = ""] = fields;
    aces.push({ type, flags, rights, sid });
  }
  return { flags: m[1] ?? "", aces };
}

/** `sid` is the user: their SID, or "LA" when they are the machine's own Administrator (RID 500). */
function isUser(sid: string, user: string): boolean {
  return sid === user || (sid === "LA" && user.endsWith("-500"));
}

/**
 * Inheritance cut off, and every entry this user's, allowing full access; a
 * folder's also passes down to what is made in it.
 */
function onlyUser(dacl: Dacl, user: string, kind: LockKind): boolean {
  return (
    dacl.flags.includes("P") &&
    dacl.aces.length > 0 &&
    dacl.aces.every((a) => a.type === "A" && isUser(a.sid, user) && FULL_ACCESS.test(a.rights)) &&
    (kind === "file" || dacl.aces.some((a) => a.flags.includes("OI") && a.flags.includes("CI")))
  );
}

/** A DACL's entries, for the log. */
function aceList(dacl: Dacl): string {
  const aces = dacl.aces.map((a) => `(${a.type};${a.flags};${a.rights};;;${a.sid})`).join("");
  return `D:${dacl.flags}${aces}`;
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

  async function runIcacls(args: readonly string[]): Promise<Result<void, AclError>> {
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
  }

  /** `path`'s DACL, saved by icacls into a new temporary folder that goes after. */
  async function readDacl(path: string): Promise<Result<Dacl, AclError>> {
    const unreadable = (why: string): Result<Dacl, AclError> => {
      log(`[acl] could not read back the ACL of ${path}: ${why}`);
      return err({ kind: "unreadable", message: "its ACL could not be read back to check it" });
    };
    let dir: string;
    try {
      dir = await mkdtemp(join(tmpdir(), "kleio-acl-"));
    } catch (e) {
      return unreadable(`no temporary folder (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
    try {
      const out = join(dir, "dacl.txt");
      const saved = await runIcacls([path, "/save", out]);
      if (!saved.ok) return saved;
      let text: Buffer;
      try {
        text = await readFile(out);
      } catch (e) {
        return unreadable(`icacls wrote no file (${(e as NodeJS.ErrnoException).code ?? "error"})`);
      }
      const dacl = parseSavedDacl(text);
      return dacl ? ok(dacl) : unreadable(`no DACL in ${logText(text.toString("utf16le"))}`);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
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
      const granted = await runIcacls([path, "/inheritance:r", "/grant:r", grant]);
      if (!granted.ok) return granted;

      // The grant keeps entries given to the path itself: remove everyone else's.
      const first = await readDacl(path);
      if (!first.ok) return first;
      if (onlyUser(first.value, user.value, kind)) return ok(undefined);
      const others = [
        ...new Set(first.value.aces.map((a) => a.sid).filter((s) => !isUser(s, user.value))),
      ].sort();
      let removed = 0;
      for (const other of others) {
        const otherSid = SID.test(other) ? other : WELL_KNOWN_SIDS.get(other);
        if (otherSid === undefined) {
          log(`[acl] ${path}: no SID for ${JSON.stringify(other)}, so its entry stays`);
          continue;
        }
        const gone = await runIcacls([path, "/remove", `*${otherSid}`]);
        if (!gone.ok) return gone;
        removed += 1;
      }
      const last = removed > 0 ? await readDacl(path) : first;
      if (!last.ok) return last;
      if (onlyUser(last.value, user.value, kind)) return ok(undefined);
      log(`[acl] ${path} isn't this user's alone after the lock: ${aceList(last.value)}`);
      return err({
        kind: "not_private",
        message: "after the lock, its ACL still isn't this user's alone",
      });
    },
  };
}
