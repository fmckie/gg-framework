import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, win32 } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSecretLock,
  lockablePath,
  parseSavedDacl,
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
import { ensureLinkSecrets, ensureSecure, lockSecrets } from "../src/secure-dir.js";

const SID = "S-1-5-21-1004336348-1177238915-682003330-1001";
const OTHER = "S-1-5-21-1004336348-1177238915-682003330-1002";
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

/** What `icacls <path> /save` writes: UTF-16LE with a BOM, the path's name, then its SDDL. */
const savedAcl = (name: string, sddl: string): Buffer =>
  Buffer.from(`\uFEFF${name}\r\n${sddl}\r\n`, "utf16le");

/** The ACL a lock leaves on a path that had nothing else on it. */
const lockedSddl = (kind: LockKind, sid = SID): string =>
  `D:PAI(A;${kind === "dir" ? "OICI" : ""};FA;;;${sid})`;

/**
 * `whoami` gets one answer, every icacls call the other. A `/save` that
 * succeeds writes the next of `saves`, then the ACL the last grant on that
 * path leaves.
 */
function fakeRun(
  whoami: Answer = ME,
  icacls: Answer = DONE,
  saves: readonly string[] = [],
): { run: RunFile; calls: Call[] } {
  const calls: Call[] = [];
  const granted = new Map<string, LockKind>();
  let saved = 0;
  const run: RunFile = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
    if (file.endsWith("\\whoami.exe")) return whoami;
    const [path = "", op = "", out = "", grant = ""] = args;
    if (op === "/inheritance:r") granted.set(path, grant.endsWith("(OI)(CI)F") ? "dir" : "file");
    if (op === "/save" && icacls.ok && icacls.value.exitCode === 0) {
      const sddl = saves[saved] ?? lockedSddl(granted.get(path) ?? "file");
      saved += 1;
      writeFileSync(out, savedAcl(win32.basename(path), sddl));
    }
    return icacls;
  };
  return { run, calls };
}
/** The commands run, with each `/save`'s temporary file as "<out>". */
const commands = (calls: readonly Call[]): string[][] =>
  calls.map((c) => [
    c.file,
    ...(c.args[1] === "/save" ? [c.args[0] ?? "", "/save", "<out>"] : c.args),
  ]);
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
  it("locks a folder and a file to the user's SID, and reads each ACL back, without a shell", async () => {
    const { run, calls } = fakeRun();
    const lock = createSecretLock({ platform: "win32", env: {}, run });
    expect(await lock.lock(DIR, "dir")).toEqual(ok(undefined));
    expect(await lock.lock(FILE, "file")).toEqual(ok(undefined));
    expect(commands(calls)).toEqual([
      WHOAMI,
      [ICACLS, DIR, "/inheritance:r", "/grant:r", `*${SID}:(OI)(CI)F`],
      [ICACLS, DIR, "/save", "<out>"],
      [ICACLS, FILE, "/inheritance:r", "/grant:r", `*${SID}:F`],
      [ICACLS, FILE, "/save", "<out>"],
    ]);
    // Each ACL is saved into a new temporary folder, gone once it has been read.
    const outs = calls.filter((c) => c.args[1] === "/save").map((c) => c.args[2] ?? "");
    expect(new Set(outs.map((out) => dirname(out))).size).toBe(2);
    for (const out of outs) {
      expect(basename(out)).toBe("dacl.txt");
      expect(dirname(dirname(out))).toBe(tmpdir());
      expect(basename(dirname(out))).toMatch(/^kleio-acl-/);
      expect(existsSync(dirname(out))).toBe(false);
    }
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
    expect(calls.filter((c) => c.args[1] === "/inheritance:r")).toHaveLength(3);
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
      expect(await files(bad)).toEqual([WHOAMI[0], ICACLS, ICACLS]);
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
    const icacls = fakeRun();
    const run: RunFile = async (file, args, options) => {
      files.push(file);
      return file === WHOAMI[0] ? whoami : icacls.run(file, args, options);
    };
    const lock = createSecretLock({ platform: "win32", env: {}, run });
    expect(kindOf(await lock.lock(FILE, "file"))).toBe("whoami_failed");
    whoami = ME;
    expect(await lock.lock(FILE, "file")).toEqual(ok(undefined));
    expect(files).toEqual([WHOAMI[0], WHOAMI[0], ICACLS, ICACLS]);
  });

  it("removes every other account's entries the grant kept, then reads the ACL again", async () => {
    // Entries given to the folder itself: what Windows writes when the folder
    // above passes nothing down, and ones someone added.
    const given = `D:PAI(A;OICI;FA;;;${SID})(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;${OTHER})(D;;FA;;;WD)`;
    const { run, calls } = fakeRun(ME, DONE, [given, lockedSddl("dir")]);
    const lock = createSecretLock({ platform: "win32", env: {}, run });
    expect(await lock.lock(DIR, "dir")).toEqual(ok(undefined));
    expect(commands(calls)).toEqual([
      WHOAMI,
      [ICACLS, DIR, "/inheritance:r", "/grant:r", `*${SID}:(OI)(CI)F`],
      [ICACLS, DIR, "/save", "<out>"],
      [ICACLS, DIR, "/remove", "*S-1-5-32-544"],
      [ICACLS, DIR, "/remove", `*${OTHER}`],
      [ICACLS, DIR, "/remove", "*S-1-5-18"],
      [ICACLS, DIR, "/remove", "*S-1-1-0"],
      [ICACLS, DIR, "/save", "<out>"],
    ]);
  });

  it("fails while anyone else is still in, with their entries in the log only", async () => {
    const open = `D:PAI(A;;FA;;;${SID})(A;;FA;;;SY)`;
    const logs: string[] = [];
    const { run, calls } = fakeRun(ME, DONE, [open, open]);
    const lock = createSecretLock({ platform: "win32", env: {}, run, log: (m) => logs.push(m) });
    const r = await lock.lock(FILE, "file");
    expect(kindOf(r)).toBe("not_private");
    expect(JSON.stringify(r)).not.toContain("(A;");
    expect(logs.join("\n")).toContain("(A;;FA;;;SY)");
    expect(commands(calls).slice(1)).toEqual([
      [ICACLS, FILE, "/inheritance:r", "/grant:r", `*${SID}:F`],
      [ICACLS, FILE, "/save", "<out>"],
      [ICACLS, FILE, "/remove", "*S-1-5-18"],
      [ICACLS, FILE, "/save", "<out>"],
    ]);
  });

  it("leaves an entry it has no SID for, and fails", async () => {
    // "DA" (Domain Admins) depends on the domain, and "LA" is someone else
    // unless the user is the machine's own Administrator.
    for (const name of ["DA", "LA"]) {
      const logs: string[] = [];
      const { run, calls } = fakeRun(ME, DONE, [`D:PAI(A;;FA;;;${SID})(A;;FA;;;${name})`]);
      const lock = createSecretLock({ platform: "win32", env: {}, run, log: (m) => logs.push(m) });
      expect(kindOf(await lock.lock(FILE, "file"))).toBe("not_private");
      expect(calls.slice(1).map((c) => c.args[1])).toEqual(["/inheritance:r", "/save"]);
      expect(logs.join("\n")).toContain(`"${name}"`);
    }
  });

  it("takes SDDL's name for the machine's own Administrator as that user", async () => {
    const admin = "S-1-5-21-1004336348-1177238915-682003330-500";
    const { run, calls } = fakeRun(ran(`"desktop-1\\administrator","${admin}"\r\n`), DONE, [
      lockedSddl("dir", "LA"),
    ]);
    const lock = createSecretLock({ platform: "win32", env: {}, run });
    expect(await lock.lock(DIR, "dir")).toEqual(ok(undefined));
    expect(calls.slice(1).map((c) => c.args[1])).toEqual(["/inheritance:r", "/save"]);
  });

  it("fails on an ACL that isn't cut off, full access and passed down, even the user's alone", async () => {
    for (const sddl of [
      `D:AI(A;OICI;FA;;;${SID})`,
      `D:PAI(A;;FA;;;${SID})`,
      `D:PAI(A;OICI;0x1200a9;;;${SID})`,
      `D:PAI(D;OICI;FA;;;${SID})`,
      "D:PAI",
    ]) {
      const { run, calls } = fakeRun(ME, DONE, [sddl]);
      const lock = createSecretLock({ platform: "win32", env: {}, run });
      expect(kindOf(await lock.lock(DIR, "dir")), sddl).toBe("not_private");
      expect(
        calls.filter((c) => c.args[1] === "/remove"),
        sddl,
      ).toEqual([]);
    }
  });

  it("fails when the ACL can't be read back", async () => {
    const garbled = fakeRun(ME, DONE, ["no DACL here"]);
    const lock = createSecretLock({ platform: "win32", env: {}, run: garbled.run });
    expect(kindOf(await lock.lock(FILE, "file"))).toBe("unreadable");

    // icacls says it saved the ACL, but wrote nothing.
    const silent: RunFile = async (file) => (file === WHOAMI[0] ? ME : DONE);
    const nothing = createSecretLock({ platform: "win32", env: {}, run: silent });
    expect(kindOf(await nothing.lock(FILE, "file"))).toBe("unreadable");

    let calls = 0;
    const saveFails: RunFile = async (file, args) => {
      if (file === WHOAMI[0]) return ME;
      calls += 1;
      return args[1] === "/save" ? ran("", 5, "Access is denied.") : DONE;
    };
    const refused = createSecretLock({ platform: "win32", env: {}, run: saveFails });
    expect(kindOf(await refused.lock(FILE, "file"))).toBe("icacls_failed");
    expect(calls).toBe(2);
  });

  it("reads the DACL icacls saves, and refuses one it can't read to its end", () => {
    expect(
      parseSavedDacl(savedAcl("secure", `D:PAI(A;OICI;FA;;;${SID})(A;;0x1200a9;;;BU)S:AI`)),
    ).toEqual({
      flags: "PAI",
      aces: [
        { type: "A", flags: "OICI", rights: "FA", sid: SID },
        { type: "A", flags: "", rights: "0x1200a9", sid: "BU" },
      ],
    });
    // No BOM, bare line feeds and a NUL at the end read the same.
    expect(parseSavedDacl(Buffer.from("key\nD:P(A;;FA;;;SY)\n\u0000", "utf16le"))).toEqual({
      flags: "P",
      aces: [{ type: "A", flags: "", rights: "FA", sid: "SY" }],
    });
    for (const bad of [
      "",
      "key\r\nO:BAD:P(A;;FA;;;SY)",
      "D:P(A;;FA;;;SY)\r\nD:P(A;;FA;;;SY)",
      `D:PAI(A;;FA;;;${SID})(XA;;FA;;;WD;(Member_of {SID(BA)}))`,
      "D:NO_ACCESS_CONTROL",
      `D:PAI(A;;FA;;;${SID};x)`,
      `D:PAI(A;;FA;;${SID})`,
      `D:PAI(A;;FA;;;${SID})(A;;FA;;;WD`,
      `D:PAI(A;;FA;;;${SID})junk`,
    ]) {
      expect(parseSavedDacl(Buffer.from(bad, "utf16le")), bad).toBeNull();
    }
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
      [p.linkKey, "file", true],
      [p.linkUpstreamToken, "file", true],
    ]);
    for (const dir of [p.rings, p.work, p.logs]) expect(statSync(dir).isDirectory()).toBe(true);
    expect(readFileSync(p.linkKey)).toHaveLength(32);
    expect(readFileSync(p.linkUpstreamToken, "utf8")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Run again, it keeps the keys it made.
    const kept = [p.masterKey, p.linkKey, p.linkUpstreamToken].map((f) => readFileSync(f));
    expect(await ensureSecure(p, lock)).toEqual(ok(undefined));
    expect([p.masterKey, p.linkKey, p.linkUpstreamToken].map((f) => readFileSync(f))).toEqual(kept);
  });

  it("ensureLinkSecrets adds the link's two secrets to a host set up before the link, once", async () => {
    const p = hostPaths(join(home, "host"));
    mkdirSync(p.secureDir, { recursive: true });
    writeFileSync(p.masterKey, "master");
    const { lock, seen } = recordingLock();
    expect(await ensureLinkSecrets(p, lock)).toEqual(ok(undefined));
    expect(seen).toEqual([
      [p.linkKey, "file"],
      [p.linkUpstreamToken, "file"],
    ]);
    if (process.platform !== "win32") {
      for (const f of [p.linkKey, p.linkUpstreamToken]) {
        expect(statSync(f).mode & 0o777).toBe(0o600);
      }
    }
    const kept = [p.linkKey, p.linkUpstreamToken].map((f) => readFileSync(f));
    expect(await ensureLinkSecrets(p, lock)).toEqual(ok(undefined));
    expect([p.linkKey, p.linkUpstreamToken].map((f) => readFileSync(f))).toEqual(kept);
    expect(readFileSync(p.masterKey, "utf8")).toBe("master");
  });

  it("ensureLinkSecrets stops at the first secret it can't lock", async () => {
    const p = hostPaths(join(home, "host"));
    mkdirSync(p.secureDir, { recursive: true });
    const failing = recordingLock((path) => path === p.linkKey);
    const r = await ensureLinkSecrets(p, failing.lock);
    expect(r.ok ? null : r.error.path).toBe(p.linkKey);
    expect(failing.seen).toEqual([[p.linkKey, "file"]]);
  });

  it("ensureSecure writes no key when secure/ can't be locked", async () => {
    const p = hostPaths(join(home, "host"));
    const r = await ensureSecure(p, recordingLock(() => true).lock);
    expect(r.ok ? null : r.error.path).toBe(p.secureDir);
    for (const key of [p.masterKey, p.controlRootKey, p.linkKey, p.linkUpstreamToken]) {
      expect(existsSync(key)).toBe(false);
    }
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

/** The real `icacls`, and checks on the ACLs it leaves (Windows only). */
function realAcls(): {
  icacls: (args: readonly string[]) => void;
  dacl: (path: string) => { flags: string; aces: Ace[] };
  onlyMine: (aces: readonly Ace[]) => void;
} {
  const system32 = windowsSystem32(process.env);
  const whoami = execFileSync(win32.join(system32, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const sid = parseWhoamiSid(whoami);
  if (sid === null) throw new Error(`no SID in ${JSON.stringify(whoami)}`);
  // SDDL writes a machine's built-in Administrator (RID 500) as "LA".
  const mine = /-500$/.test(sid) ? [sid, "LA"] : [sid];
  const icacls = (args: readonly string[]): void => {
    execFileSync(win32.join(system32, "icacls.exe"), [...args], { windowsHide: true });
  };
  let n = 0;
  return {
    icacls,
    dacl: (path) => {
      const out = join(home, `acl-${(n += 1)}.txt`);
      icacls([path, "/save", out]);
      return savedDacl(readFileSync(out));
    },
    onlyMine: (aces) => {
      expect(aces.length).toBeGreaterThan(0);
      for (const ace of aces) {
        expect(ace.type).toBe("A");
        expect(mine).toContain(ace.sid);
        // Full access: "FA", or its mask spelled out.
        expect(ace.rights.toUpperCase()).toMatch(/^(FA|0X1F01FF)$/);
      }
    },
  };
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

    const { dacl, onlyMine } = realAcls();
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

  it("ensureSecure takes back what secure/ and a key were open to before", async () => {
    const p = hostPaths(join(home, "host"));
    mkdirSync(p.secureDir, { recursive: true });
    writeFileSync(p.masterKey, "k".repeat(64));
    const lock = createSecretLock({ platform: process.platform, env: process.env });

    if (process.platform !== "win32") {
      chmodSync(p.secureDir, 0o755);
      chmodSync(p.masterKey, 0o644);
      expect(await ensureSecure(p, lock)).toEqual(ok(undefined));
      expect(statSync(p.secureDir).mode & 0o777).toBe(0o700);
      expect(statSync(p.masterKey).mode & 0o777).toBe(0o600);
      return;
    }

    // Entries given to the folder and the key themselves, not passed down, so
    // cutting inheritance off keeps them: Users may read the folder and what's
    // in it, and Everyone the key.
    const { icacls, dacl, onlyMine } = realAcls();
    icacls([p.secureDir, "/grant", "*S-1-5-32-545:(OI)(CI)R"]);
    icacls([p.masterKey, "/grant", "*S-1-1-0:R"]);
    expect(dacl(p.secureDir).aces.map((a) => a.sid)).toContain("BU");
    expect(dacl(p.masterKey).aces.map((a) => a.sid)).toContain("WD");

    expect(await ensureSecure(p, lock)).toEqual(ok(undefined));
    for (const path of [p.secureDir, p.masterKey, p.controlRootKey]) {
      const locked = dacl(path);
      expect(locked.flags).toContain("P");
      onlyMine(locked.aces);
    }
  }, 60_000);
});
