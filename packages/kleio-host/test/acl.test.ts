import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSecretLock,
  lockablePath,
  parseWhoamiSid,
  type AclError,
  type LockKind,
  type SecretLock,
} from "../src/acl.js";
import { hostPaths } from "../src/paths.js";
import { err, ok, type Result } from "../src/result.js";
import {
  windowsSystem32,
  type RunFailure,
  type RunFile,
  type RunFileOptions,
  type RunOutput,
} from "../src/run-file.js";
import { ensureSecure, lockSecrets } from "../src/secure-dir.js";

const SID = "S-1-5-21-1004336348-1177238915-682003330-1001";
const WHOAMI = ["C:\\Windows\\System32\\whoami.exe", "/user", "/fo", "csv", "/nh"];
const ICACLS = "C:\\Windows\\System32\\icacls.exe";
const DIR = "C:\\Users\\k\\AppData\\Local\\Kleio\\host\\secure";
const FILE = "C:\\Users\\k\\AppData\\Local\\Kleio\\host\\composio.key";

type Answer = Result<RunOutput, RunFailure>;
const ran = (stdout: string, exitCode = 0, stderr = ""): Answer => ok({ exitCode, stdout, stderr });
const ME = ran(`"desktop-1\\kleio","${SID}"\r\n`);
const DONE = ran(
  "processed file: x\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n",
);

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: RunFileOptions;
}

/** `whoami` gets one answer, every icacls call the other. */
function fakeRun(whoami: Answer = ME, icacls: Answer = DONE): { run: RunFile; calls: Call[] } {
  const calls: Call[] = [];
  const run: RunFile = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
    return file.endsWith("\\whoami.exe") ? whoami : icacls;
  };
  return { run, calls };
}
const commands = (calls: readonly Call[]): string[][] => calls.map((c) => [c.file, ...c.args]);
const kindOf = (r: Result<void, AclError>): string | null => (r.ok ? null : r.error.kind);

/** A lock that records what it was asked, and fails where `fails` says. */
function recordingLock(fails: (path: string) => boolean = () => false): {
  lock: SecretLock;
  seen: [string, LockKind][];
} {
  const seen: [string, LockKind][] = [];
  const lock: SecretLock = {
    lock: async (path, kind) => {
      seen.push([path, kind]);
      return fails(path)
        ? err({ kind: "icacls_failed", message: "icacls exited with 5" })
        : ok(undefined);
    },
  };
  return { lock, seen };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kleio-acl-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

describe("createSecretLock on Windows (fake programs)", () => {
  it("locks a folder and a file to the user's SID, by absolute path, without a shell", async () => {
    const { run, calls } = fakeRun();
    const lock = createSecretLock({ platform: "win32", env: {}, run });
    expect(await lock.lock(DIR, "dir")).toEqual(ok(undefined));
    expect(await lock.lock(FILE, "file")).toEqual(ok(undefined));
    expect(commands(calls)).toEqual([
      WHOAMI,
      [ICACLS, DIR, "/inheritance:r", "/grant:r", `*${SID}:(OI)(CI)F`],
      [ICACLS, FILE, "/inheritance:r", "/grant:r", `*${SID}:F`],
    ]);
    for (const call of calls) {
      expect(call.options).toEqual({
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
    }
  });

  it("looks the SID up once, even for locks asked for at the same time", async () => {
    const { run, calls } = fakeRun();
    const lock = createSecretLock({ platform: "win32", env: {}, run });
    const all = await Promise.all([lock.lock(DIR, "dir"), lock.lock(FILE, "file")]);
    expect(all).toEqual([ok(undefined), ok(undefined)]);
    expect(await lock.lock(FILE, "file")).toEqual(ok(undefined));
    expect(calls.filter((c) => c.file === WHOAMI[0])).toHaveLength(1);
    expect(calls.filter((c) => c.file === ICACLS)).toHaveLength(3);
  });

  it("runs them from %SystemRoot% only when it is a plain drive path", async () => {
    const files = async (SystemRoot: string): Promise<string[]> => {
      const { run, calls } = fakeRun();
      await createSecretLock({ platform: "win32", env: { SystemRoot }, run }).lock(FILE, "file");
      return calls.map((c) => c.file);
    };
    expect(await files("D:\\Win")).toEqual([
      "D:\\Win\\System32\\whoami.exe",
      "D:\\Win\\System32\\icacls.exe",
    ]);
    for (const bad of [
      "",
      "Windows",
      "\\\\server\\share\\Windows",
      'C:\\Win"dows',
      "C:/Windows",
      "C:\\Windows\r\nX",
    ]) {
      expect(await files(bad)).toEqual([WHOAMI[0], ICACLS]);
    }
  });

  it("refuses a path icacls can't be given safely, before running anything", async () => {
    for (const path of [
      "secure",
      ".\\secure",
      "C:relative",
      "/tmp/secure",
      'C:\\a"b',
      "C:\\a\nb",
      "C:\\a\rb",
    ]) {
      const { run, calls } = fakeRun();
      const lock = createSecretLock({ platform: "win32", env: {}, run });
      expect(kindOf(await lock.lock(path, "dir"))).toBe("bad_path");
      expect(calls).toEqual([]);
    }
    expect(lockablePath(DIR)).toBe(true);
    expect(lockablePath("\\\\server\\share\\Kleio")).toBe(true);
  });

  it("a failure is an error in its own words; the programs' output goes to the log only", async () => {
    const cases: [Answer, Answer, string][] = [
      [err({ kind: "spawn_failed", message: "could not start (ENOENT)" }), DONE, "whoami_failed"],
      [ran("", 1, "RAW-WHOAMI-ERR"), DONE, "whoami_failed"],
      [ran("RAW-WHOAMI-GARBAGE\r\n"), DONE, "bad_sid"],
      [ran(`"x\\y","${SID} RAW-WHOAMI-EXTRA"`), DONE, "bad_sid"],
      [ME, ran("", 5, "RAW-ICACLS: Access is denied.\r\n"), "icacls_failed"],
      [ME, err({ kind: "timeout", message: "no answer within 10000 ms" }), "icacls_failed"],
    ];
    for (const [whoami, icacls, kind] of cases) {
      const logs: string[] = [];
      const { run } = fakeRun(whoami, icacls);
      const lock = createSecretLock({ platform: "win32", env: {}, run, log: (m) => logs.push(m) });
      const r = await lock.lock(FILE, "file");
      expect(kindOf(r)).toBe(kind);
      expect(JSON.stringify(r)).not.toContain("RAW-");
      const raw = [whoami, icacls]
        .flatMap((a) => (a.ok ? [a.value.stdout, a.value.stderr] : []))
        .flatMap((text) => text.match(/RAW-[A-Z-]+/g) ?? []);
      for (const marker of raw) expect(logs.join("\n")).toContain(marker);
    }
  });

  it("doesn't keep a failed SID lookup: the next lock asks again", async () => {
    let whoami = ran("", 1);
    const files: string[] = [];
    const run: RunFile = async (file) => {
      files.push(file);
      return file === WHOAMI[0] ? whoami : DONE;
    };
    const lock = createSecretLock({ platform: "win32", env: {}, run });
    expect(kindOf(await lock.lock(FILE, "file"))).toBe("whoami_failed");
    whoami = ME;
    expect(await lock.lock(FILE, "file")).toEqual(ok(undefined));
    expect(files).toEqual([WHOAMI[0], WHOAMI[0], ICACLS]);
  });

  it("reads the SID from whoami's CSV, and nothing that only looks like one", () => {
    expect(parseWhoamiSid(`"desktop-1\\kleio","${SID}"\r\n`)).toBe(SID);
    expect(parseWhoamiSid(`"a ""quoted"", name","${SID}"`)).toBe(SID);
    expect(parseWhoamiSid(`desktop-1\\kleio,${SID}`)).toBe(SID);
    for (const bad of [
      "",
      `"x","S-1"`,
      `"x","not-a-sid"`,
      `"x","${SID} /grant Everyone:F"`,
      `"x","${SID}`,
    ]) {
      expect(parseWhoamiSid(bad)).toBeNull();
    }
  });
});

describe("createSecretLock elsewhere", () => {
  it("does nothing and runs nothing", async () => {
    for (const platform of ["darwin", "linux", "freebsd"]) {
      const { run, calls } = fakeRun();
      const lock = createSecretLock({ platform, env: {}, run });
      expect(await lock.lock("relative/even", "dir")).toEqual(ok(undefined));
      expect(calls).toEqual([]);
    }
  });
});

describe("ensureSecure and lockSecrets (fake lock)", () => {
  it("ensureSecure locks secure/ before any key is in it, then each key", async () => {
    const p = hostPaths(join(home, "host"));
    const seen: [string, LockKind, boolean][] = [];
    const lock: SecretLock = {
      lock: async (path, kind) => {
        seen.push([path, kind, existsSync(p.masterKey)]);
        return ok(undefined);
      },
    };
    expect(await ensureSecure(p, lock)).toEqual(ok(undefined));
    expect(seen).toEqual([
      [p.secureDir, "dir", false],
      [p.masterKey, "file", true],
      [p.controlRootKey, "file", true],
    ]);
    for (const dir of [p.rings, p.work, p.logs]) expect(statSync(dir).isDirectory()).toBe(true);
    // Run again, it keeps the keys it made.
    const key = readFileSync(p.masterKey);
    expect(await ensureSecure(p, lock)).toEqual(ok(undefined));
    expect(readFileSync(p.masterKey).equals(key)).toBe(true);
  });

  it("ensureSecure writes no key when secure/ can't be locked", async () => {
    const p = hostPaths(join(home, "host"));
    const r = await ensureSecure(p, recordingLock(() => true).lock);
    expect(r.ok ? null : r.error.path).toBe(p.secureDir);
    expect(existsSync(p.masterKey)).toBe(false);
    expect(existsSync(p.controlRootKey)).toBe(false);
  });

  it("lockSecrets locks secure/, each file in it, and the key and endpoint files that exist", async () => {
    const p = hostPaths(join(home, "host"));
    mkdirSync(join(p.secureDir, "a-folder"), { recursive: true });
    for (const f of [p.masterKey, p.controlRootKey, p.adminToken, p.registry, p.composioKey]) {
      writeFileSync(f, "x");
    }
    writeFileSync(p.sidecarEndpoint, "{}");
    const { lock, seen } = recordingLock();
    expect(await lockSecrets(p, lock)).toEqual(ok(undefined));
    expect(seen).toEqual([
      [p.secureDir, "dir"],
      [p.adminToken, "file"],
      [p.controlRootKey, "file"],
      [p.registry, "file"],
      [p.masterKey, "file"],
      [p.composioKey, "file"],
      [p.sidecarEndpoint, "file"],
    ]);
  });

  it("lockSecrets locks nothing before init, and stops at the first failure", async () => {
    const none = recordingLock();
    expect(await lockSecrets(hostPaths(join(home, "none")), none.lock)).toEqual(ok(undefined));
    expect(none.seen).toEqual([]);

    const p = hostPaths(join(home, "host"));
    mkdirSync(p.secureDir, { recursive: true });
    for (const f of [p.masterKey, p.adminToken]) writeFileSync(f, "x");
    writeFileSync(p.typesafeKey, "x");
    const failing = recordingLock((path) => path === p.adminToken);
    const r = await lockSecrets(p, failing.lock);
    expect(r.ok ? null : r.error.path).toBe(p.adminToken);
    expect(failing.seen).toEqual([
      [p.secureDir, "dir"],
      [p.adminToken, "file"],
    ]);
  });
});

/** One ACE of an SDDL DACL: type;flags;rights;object;inherited object;SID. */
interface Ace {
  readonly type: string;
  readonly flags: string;
  readonly rights: string;
  readonly sid: string;
}

/** The DACL in what `icacls <path> /save` writes: UTF-16LE, the name, then its SDDL. */
function savedDacl(saved: Buffer): { flags: string; aces: Ace[] } {
  const text = saved.toString("utf16le").replace(/^\uFEFF/, "");
  const line = text.split(/\r?\n/).find((l) => l.startsWith("D:"));
  const m = line === undefined ? null : /^D:([A-Z]*)((?:\([^()]*\))*)/.exec(line);
  if (!m) throw new Error(`no DACL in ${JSON.stringify(text)}`);
  const aces = [...(m[2] ?? "").matchAll(/\(([^()]*)\)/g)].map((a): Ace => {
    const [type = "", flags = "", rights = "", , , sid = ""] = (a[1] ?? "").split(";");
    return { type, flags, rights, sid };
  });
  return { flags: m[1] ?? "", aces };
}

describe("for real on this OS", () => {
  it("ensureSecure leaves the secrets open to this user only", async () => {
    const p = hostPaths(join(home, "host"));
    const logs: string[] = [];
    const lock = createSecretLock({
      platform: process.platform,
      env: process.env,
      log: (m) => logs.push(m),
    });
    const secured = await ensureSecure(p, lock);
    expect({ secured, logs }).toEqual({ secured: ok(undefined), logs: [] });
    const later = join(p.secureDir, "later.json");
    writeFileSync(later, "{}");

    if (process.platform !== "win32") {
      expect(statSync(p.secureDir).mode & 0o777).toBe(0o700);
      for (const key of [p.masterKey, p.controlRootKey]) {
        expect(statSync(key).mode & 0o777).toBe(0o600);
      }
      return;
    }

    const system32 = windowsSystem32(process.env);
    const whoami = execFileSync(
      win32.join(system32, "whoami.exe"),
      ["/user", "/fo", "csv", "/nh"],
      { encoding: "utf8", windowsHide: true },
    );
    const sid = parseWhoamiSid(whoami);
    if (sid === null) throw new Error(`no SID in ${JSON.stringify(whoami)}`);
    // SDDL writes a machine's built-in Administrator (RID 500) as "LA".
    const mine = /-500$/.test(sid) ? [sid, "LA"] : [sid];
    let n = 0;
    const dacl = (path: string): { flags: string; aces: Ace[] } => {
      const out = join(home, `acl-${(n += 1)}.txt`);
      execFileSync(win32.join(system32, "icacls.exe"), [path, "/save", out], {
        windowsHide: true,
      });
      return savedDacl(readFileSync(out));
    };
    const onlyMine = (aces: readonly Ace[]): void => {
      expect(aces.length).toBeGreaterThan(0);
      for (const ace of aces) {
        expect(ace.type).toBe("A");
        expect(mine).toContain(ace.sid);
        // Full access: "FA", or its mask spelled out.
        expect(ace.rights.toUpperCase()).toMatch(/^(FA|0X1F01FF)$/);
      }
    };

    const dir = dacl(p.secureDir);
    expect(dir.flags).toContain("P");
    onlyMine(dir.aces);
    expect(dir.aces.some((a) => a.flags.includes("OI") && a.flags.includes("CI"))).toBe(true);
    for (const key of [p.masterKey, p.controlRootKey]) {
      const file = dacl(key);
      expect(file.flags).toContain("P");
      onlyMine(file.aces);
    }
    // A file made later in secure/ gets the folder's one entry, inherited.
    const inherited = dacl(later);
    onlyMine(inherited.aces);
    expect(inherited.aces).toHaveLength(1);
    expect(inherited.aces[0]?.flags).toBe("ID");
  }, 60_000);
});
