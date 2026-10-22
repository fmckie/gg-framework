import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALWAYS_ON_REASONS,
  ALWAYS_ON_RUN,
  ALWAYS_ON_STATES,
  checkAlwaysOn,
  parsePmsetAc,
  parsePowercfgAc,
  pmsetHasInternalBattery,
  pmsetVerdict,
  powercfgVerdict,
  sleepTargetVerdict,
  systemctlWord,
  type AlwaysOn,
} from "../src/always-on.js";
import { err, ok, type Result } from "../src/result.js";
import type { RunFailure, RunFile, RunFileOptions, RunOutput } from "../src/run-file.js";

const FIXTURES = resolve(__dirname, "fixtures/always-on");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
/** Windows prints CRLF; the fixtures are stored with LF. */
const crlf = (text: string): string => text.replace(/\r?\n/g, "\r\n");

const YES: AlwaysOn = { state: "yes", reasons: [] };
const LAPTOP: AlwaysOn = { state: "laptop", reasons: [] };
const FAILED: AlwaysOn = { state: "unknown", reasons: ["check_failed"] };

// ------------------------------------------------------------ fake runner

type Answer = Result<RunOutput, RunFailure>;
const ran = (stdout: string, exitCode = 0, stderr = ""): Answer => ok({ exitCode, stdout, stderr });
const cannotStart: Answer = err({ kind: "spawn_failed", message: "could not start (ENOENT)" });
const hung: Answer = err({ kind: "timeout", message: "no answer within 5000 ms" });

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: RunFileOptions;
}

/** Answers by "<file> <args…>"; a program it has no answer for couldn't start. */
function fakeRun(answers: Readonly<Record<string, Answer>>): { run: RunFile; calls: Call[] } {
  const calls: Call[] = [];
  const run: RunFile = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
    return answers[[file, ...args].join(" ")] ?? cannotStart;
  };
  return { run, calls };
}
const commands = (calls: readonly Call[]): string[][] => calls.map((c) => [c.file, ...c.args]);

const PMSET_BATT = ["/usr/bin/pmset", "-g", "batt"];
const PMSET_CUSTOM = ["/usr/bin/pmset", "-g", "custom"];
const BATT = PMSET_BATT.join(" ");
const CUSTOM = PMSET_CUSTOM.join(" ");

const REG_QUERY = [
  "C:\\Windows\\System32\\reg.exe",
  "query",
  "HKLM\\SYSTEM\\CurrentControlSet\\Enum\\ACPI\\PNP0C0A",
];
const POWERCFG_QUERY = [
  "C:\\Windows\\System32\\powercfg.exe",
  "/query",
  "SCHEME_CURRENT",
  "SUB_SLEEP",
  "STANDBYIDLE",
];
const REG = REG_QUERY.join(" ");
const POWERCFG = POWERCFG_QUERY.join(" ");
const NO_BATTERY_KEY = ran(
  "",
  1,
  "ERROR: The system was unable to find the specified registry key or value.\r\n",
);

const GET_DEFAULT = ["/usr/bin/systemctl", "get-default"];
const IS_ENABLED = ["/usr/bin/systemctl", "is-enabled", "sleep.target"];

// ------------------------------------------------------------ fake sysfs

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** A fake /sys: power supplies by name, each with its attribute files. */
function sysfs(supplies: Readonly<Record<string, Readonly<Record<string, string>>>>): string {
  const root = mkdtempSync(join(tmpdir(), "kleio-sysfs-"));
  roots.push(root);
  for (const [name, attrs] of Object.entries(supplies)) {
    const dir = join(root, "sys", "class", "power_supply", name);
    mkdirSync(dir, { recursive: true });
    for (const [attr, value] of Object.entries(attrs)) writeFileSync(join(dir, attr), `${value}\n`);
  }
  return root;
}
const NO_BATTERY = { AC: { type: "Mains", online: "1" } };

// ------------------------------------------------------------ tests

describe("macOS (pmset)", () => {
  it("a MacBook is a laptop from its InternalBattery line; nothing more is run", async () => {
    const { run, calls } = fakeRun({ [BATT]: ran(fixture("macbook-batt.txt")) });
    expect(await checkAlwaysOn({ platform: "darwin", env: {}, run })).toEqual(LAPTOP);
    expect(commands(calls)).toEqual([PMSET_BATT]);
  });

  it("the mini stays on: no battery, never sleeps on AC, restarts and wakes", async () => {
    const { run, calls } = fakeRun({
      [BATT]: ran(fixture("mini-batt.txt")),
      [CUSTOM]: ran(fixture("mini-custom.txt")),
    });
    expect(await checkAlwaysOn({ platform: "darwin", env: {}, run })).toEqual(YES);
    expect(commands(calls)).toEqual([PMSET_BATT, PMSET_CUSTOM]);
  });

  it("a desktop that may sleep names each setting", async () => {
    const { run } = fakeRun({
      [BATT]: ran(fixture("mini-batt.txt")),
      [CUSTOM]: ran(fixture("built-desktop-sleepy-custom.txt")),
    });
    expect(await checkAlwaysOn({ platform: "darwin", env: {}, run })).toEqual({
      state: "may_sleep",
      reasons: ["sleeps_on_ac", "no_autorestart", "no_wake_for_network"],
    });
  });

  it("a UPS's battery line doesn't make a desktop a laptop", async () => {
    const batt = fixture("built-desktop-ups-batt.txt");
    expect(pmsetHasInternalBattery(batt)).toBe(false);
    expect(pmsetHasInternalBattery(fixture("mini-batt.txt"))).toBe(false);
    expect(pmsetHasInternalBattery(fixture("macbook-batt.txt"))).toBe(true);
    const { run } = fakeRun({ [BATT]: ran(batt), [CUSTOM]: ran(fixture("mini-custom.txt")) });
    expect(await checkAlwaysOn({ platform: "darwin", env: {}, run })).toEqual(YES);
  });

  it("reads only the AC Power section", () => {
    const ac = parsePmsetAc(fixture("macbook-custom.txt"));
    expect(ac?.get("sleep")).toBe(0); // Battery Power: 1
    expect(ac?.get("womp")).toBe(1); // Battery Power: 0
    expect(ac?.get("Sleep On Power Button")).toBe(1);
    expect(ac?.has("hibernatefile")).toBe(false); // a path, not a number
    // This Mac has no autorestart setting, so it isn't flagged.
    expect(ac?.has("autorestart")).toBe(false);
    expect(pmsetVerdict(fixture("macbook-custom.txt"))).toEqual(YES);
    expect(parsePmsetAc(crlf(fixture("mini-custom.txt")))?.get("autorestart")).toBe(1);
  });

  it("custom output without an AC section or its sleep setting is check_failed", () => {
    expect(parsePmsetAc("Battery Power:\n sleep 1\n")).toBeNull();
    for (const custom of ["", "garbage", "Battery Power:\n sleep 0\n", "AC Power:\n womp 1\n"]) {
      expect(pmsetVerdict(custom)).toEqual(FAILED);
    }
  });

  it("anything that goes wrong is unknown / check_failed", async () => {
    const desktop = ran(fixture("mini-batt.txt"));
    const cases: Readonly<Record<string, Answer>>[] = [
      {},
      { [BATT]: hung },
      { [BATT]: ran("", 1, "pmset: error\n") },
      { [BATT]: desktop },
      { [BATT]: desktop, [CUSTOM]: hung },
      { [BATT]: desktop, [CUSTOM]: ran(fixture("mini-custom.txt"), 1) },
      { [BATT]: desktop, [CUSTOM]: ran("garbage\n") },
    ];
    for (const answers of cases) {
      const { run } = fakeRun(answers);
      expect(await checkAlwaysOn({ platform: "darwin", env: {}, run })).toEqual(FAILED);
    }
  });
});

describe("Windows (reg.exe, powercfg.exe)", () => {
  it("an ACPI battery is a laptop; powercfg isn't run", async () => {
    const key = "\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\ACPI\\PNP0C0A\\1\r\n\r\n";
    const { run, calls } = fakeRun({ [REG]: ran(key) });
    expect(await checkAlwaysOn({ platform: "win32", env: {}, run })).toEqual(LAPTOP);
    expect(commands(calls)).toEqual([REG_QUERY]);
  });

  it("a PC set never to sleep on AC stays on", async () => {
    const { run, calls } = fakeRun({
      [REG]: NO_BATTERY_KEY,
      [POWERCFG]: ran(crlf(fixture("built-powercfg-never.txt"))),
    });
    expect(await checkAlwaysOn({ platform: "win32", env: {}, run })).toEqual(YES);
    expect(commands(calls)).toEqual([REG_QUERY, POWERCFG_QUERY]);
  });

  it("sleep after 30 minutes on AC is sleeps_on_ac", async () => {
    const { run } = fakeRun({
      [REG]: NO_BATTERY_KEY,
      [POWERCFG]: ran(crlf(fixture("built-powercfg-30min.txt"))),
    });
    expect(await checkAlwaysOn({ platform: "win32", env: {}, run })).toEqual({
      state: "may_sleep",
      reasons: ["sleeps_on_ac"],
    });
  });

  it("reads the AC index in seconds, by its label or, translated, as the fourth of five values", () => {
    expect(parsePowercfgAc(crlf(fixture("built-powercfg-never.txt")))).toBe(0);
    expect(parsePowercfgAc(crlf(fixture("built-powercfg-30min.txt")))).toBe(1800);
    expect(parsePowercfgAc(fixture("built-powercfg-30min.txt"))).toBe(1800);
    const german = crlf(fixture("built-powercfg-german.txt"));
    expect(parsePowercfgAc(german)).toBe(3600);
    expect(powercfgVerdict(german)).toEqual({ state: "may_sleep", reasons: ["sleeps_on_ac"] });
  });

  it("UNKNOWN, or values it can't place, are check_failed", () => {
    expect(powercfgVerdict(crlf(fixture("built-powercfg-unknown.txt")))).toEqual(FAILED);
    for (const query of [
      "",
      "garbage",
      "0x00000000 0x00000001", // unlabelled, and not five values
      "Current AC Power Setting Index: 0x1ffffffff", // more than 32 bits
    ]) {
      expect(parsePowercfgAc(query)).toBeNull();
      expect(powercfgVerdict(query)).toEqual(FAILED);
    }
  });

  it("runs Windows' own programs from %SystemRoot% only when it is a plain drive path", async () => {
    const at = (root: string): string[] => [
      `${root}\\System32\\reg.exe`,
      `${root}\\System32\\powercfg.exe`,
    ];
    // Every program "exits 1": no battery key, then a powercfg that failed.
    const files = async (env: Record<string, string>): Promise<string[]> => {
      const seen: string[] = [];
      const run: RunFile = async (file) => {
        seen.push(file);
        return NO_BATTERY_KEY;
      };
      await checkAlwaysOn({ platform: "win32", env, run });
      return seen;
    };
    expect(await files({ SystemRoot: "D:\\Win" })).toEqual(at("D:\\Win"));
    for (const SystemRoot of [
      "Windows",
      "\\\\server\\share\\Windows",
      'C:\\Win"dows',
      "C:/Windows",
      "C:\\Windows\r\nX",
    ]) {
      expect(await files({ SystemRoot })).toEqual(at("C:\\Windows"));
    }
  });

  it("anything that goes wrong is unknown / check_failed", async () => {
    const cases: Readonly<Record<string, Answer>>[] = [
      {},
      { [REG]: hung },
      { [REG]: ran("", 2, "ERROR: Invalid syntax.\r\n") },
      { [REG]: NO_BATTERY_KEY },
      { [REG]: NO_BATTERY_KEY, [POWERCFG]: hung },
      {
        [REG]: NO_BATTERY_KEY,
        [POWERCFG]: ran("The power scheme, subgroup or setting specified does not exist.\r\n", 1),
      },
      { [REG]: NO_BATTERY_KEY, [POWERCFG]: ran("garbage\r\n") },
    ];
    for (const answers of cases) {
      const { run } = fakeRun(answers);
      expect(await checkAlwaysOn({ platform: "win32", env: {}, run })).toEqual(FAILED);
    }
  });
});

describe("Linux (sysfs, systemctl)", () => {
  const linux = (sysfsRoot: string, answers: Readonly<Record<string, Answer>>) => {
    const { run, calls } = fakeRun(answers);
    return { calls, check: () => checkAlwaysOn({ platform: "linux", env: {}, run, sysfsRoot }) };
  };
  const GET = GET_DEFAULT.join(" ");
  const ENABLED = IS_ENABLED.join(" ");

  it("a battery in sysfs is a laptop; nothing is run", async () => {
    const root = sysfs({ ...NO_BATTERY, BAT0: { type: "Battery", status: "Charging" } });
    const { calls, check } = linux(root, {});
    expect(await check()).toEqual(LAPTOP);
    expect(calls).toEqual([]);
  });

  it("a mouse's battery (scope Device) doesn't count; a server with no desktop stays on", async () => {
    const root = sysfs({ ...NO_BATTERY, hidpp_battery_0: { type: "Battery", scope: "Device" } });
    const { calls, check } = linux(root, { [GET]: ran("multi-user.target\n") });
    expect(await check()).toEqual(YES);
    expect(commands(calls)).toEqual([GET_DEFAULT]);
  });

  it("no power_supply folder at all is no battery", async () => {
    const { check } = linux(sysfs({}), { [GET]: ran("multi-user.target\n") });
    expect(await check()).toEqual(YES);
  });

  it("a desktop stays on when sleep.target is masked (is-enabled exits 1 for that)", async () => {
    for (const word of ["masked", "masked-runtime"]) {
      const { calls, check } = linux(sysfs(NO_BATTERY), {
        [GET]: ran("graphical.target\n"),
        [ENABLED]: ran(`${word}\n`, 1),
      });
      expect(await check()).toEqual(YES);
      expect(commands(calls)).toEqual([GET_DEFAULT, IS_ENABLED]);
    }
  });

  it("a desktop whose sleep.target isn't masked may sleep", async () => {
    for (const [word, code] of [
      ["static", 0],
      ["enabled", 0],
      ["disabled", 1],
    ] as const) {
      const { check } = linux(sysfs(NO_BATTERY), {
        [GET]: ran("graphical.target\n"),
        [ENABLED]: ran(`${word}\n`, code),
      });
      expect(await check()).toEqual({ state: "may_sleep", reasons: ["sleep_not_masked"] });
    }
  });

  it("uses /bin/systemctl when /usr/bin/systemctl can't start", async () => {
    const { calls, check } = linux(sysfs(NO_BATTERY), {
      "/bin/systemctl get-default": ran("graphical.target\n"),
      "/bin/systemctl is-enabled sleep.target": ran("masked\n", 1),
    });
    expect(await check()).toEqual(YES);
    expect(commands(calls)).toEqual([
      GET_DEFAULT,
      ["/bin/systemctl", "get-default"],
      ["/bin/systemctl", "is-enabled", "sleep.target"],
    ]);
  });

  it("anything that goes wrong is unknown / check_failed", async () => {
    const graphical = ran("graphical.target\n");
    const cases: Readonly<Record<string, Answer>>[] = [
      {},
      { [GET]: ran("", 1) },
      { [GET]: ran("\n") },
      { [GET]: graphical },
      { [GET]: graphical, [ENABLED]: hung },
      { [GET]: graphical, [ENABLED]: ran("", 1) },
      { [GET]: graphical, [ENABLED]: ran("frobnicated\n") },
    ];
    for (const answers of cases) {
      const { check } = linux(sysfs(NO_BATTERY), answers);
      expect(await check()).toEqual(FAILED);
    }
  });

  it("a systemctl that hangs isn't tried again at the other path", async () => {
    const { calls, check } = linux(sysfs(NO_BATTERY), { [GET]: hung });
    expect(await check()).toEqual(FAILED);
    expect(commands(calls)).toEqual([GET_DEFAULT]);
  });

  it("reads systemctl's first line, and knows its documented words", () => {
    expect(systemctlWord("  static \r\n")).toBe("static");
    expect(systemctlWord("")).toBe("");
    expect(sleepTargetVerdict("masked\n")).toEqual(YES);
    expect(sleepTargetVerdict("static\n")).toEqual({
      state: "may_sleep",
      reasons: ["sleep_not_masked"],
    });
    expect(sleepTargetVerdict("")).toEqual(FAILED);
  });
});

describe("every platform", () => {
  it("other OSes are unknown / unsupported_os, and nothing is run", async () => {
    for (const platform of ["freebsd", "openbsd", "sunos", "aix"]) {
      const { run, calls } = fakeRun({});
      expect(await checkAlwaysOn({ platform, env: {}, run })).toEqual({
        state: "unknown",
        reasons: ["unsupported_os"],
      });
      expect(calls).toEqual([]);
    }
  });

  it("runs each program without a shell, hidden, with a 5 s timeout and 256 KiB of output", async () => {
    const all: Call[] = [];
    const mac = fakeRun({
      [BATT]: ran(fixture("mini-batt.txt")),
      [CUSTOM]: ran(fixture("mini-custom.txt")),
    });
    await checkAlwaysOn({ platform: "darwin", env: {}, run: mac.run });
    const win = fakeRun({
      [REG]: NO_BATTERY_KEY,
      [POWERCFG]: ran(fixture("built-powercfg-never.txt")),
    });
    await checkAlwaysOn({ platform: "win32", env: {}, run: win.run });
    const lin = fakeRun({
      [GET_DEFAULT.join(" ")]: ran("graphical.target\n"),
      [IS_ENABLED.join(" ")]: ran("masked\n", 1),
    });
    await checkAlwaysOn({ platform: "linux", env: {}, run: lin.run, sysfsRoot: sysfs(NO_BATTERY) });
    all.push(...mac.calls, ...win.calls, ...lin.calls);
    expect(all).toHaveLength(6);
    for (const call of all) {
      expect(call.options).toEqual({
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 256 * 1024,
      });
      expect(call.options).toEqual(ALWAYS_ON_RUN);
    }
  });

  it("logs the programs' raw output, one line each, but never answers with it", async () => {
    const logs: string[] = [];
    const { run } = fakeRun({
      [BATT]: ran(`${fixture("mini-batt.txt")}RAW-STDOUT-7f3a\n`, 0, "RAW-STDERR-7f3a"),
      [CUSTOM]: ran(fixture("mini-custom.txt"), 0, "x".repeat(10_000)),
    });
    const result = await checkAlwaysOn({
      platform: "darwin",
      env: {},
      run,
      log: (m) => logs.push(m),
    });
    expect(result).toEqual(YES);
    expect(JSON.stringify(result)).not.toMatch(/RAW-|AC Power|xxx/);
    const text = logs.join("\n");
    expect(text).toContain("/usr/bin/pmset");
    expect(text).toContain("RAW-STDOUT-7f3a");
    expect(text).toContain("RAW-STDERR-7f3a");
    // At most the first 2 KB of each stream.
    expect(text).toContain("x".repeat(2048));
    expect(text).not.toContain("x".repeat(2049));
    for (const line of logs) expect(line).not.toMatch(/[\r\n]/);
    expect(logs.at(-1)).toBe("[host] alwaysOn yes []");
  });

  it("a runner that throws is check_failed, never an exception", async () => {
    const logs: string[] = [];
    const run: RunFile = async () => {
      throw new Error("boom");
    };
    expect(
      await checkAlwaysOn({ platform: "win32", env: {}, run, log: (m) => logs.push(m) }),
    ).toEqual(FAILED);
    expect(logs).toEqual([
      "[host] alwaysOn check threw: boom",
      "[host] alwaysOn unknown [check_failed]",
    ]);
  });
});

describe("on this machine", () => {
  it("the real check gives a well-formed answer (its programs' output goes to the CI log)", async () => {
    const logs: string[] = [];
    const result = await checkAlwaysOn({
      platform: process.platform,
      env: process.env,
      log: (m) => logs.push(m),
    });
    console.log(logs.join("\n"));
    expect(ALWAYS_ON_STATES).toContain(result.state);
    for (const reason of result.reasons) expect(ALWAYS_ON_REASONS).toContain(reason);
    if (result.state === "may_sleep") expect(result.reasons.length).toBeGreaterThan(0);
    else if (result.state === "unknown") {
      expect([["check_failed"], ["unsupported_os"]]).toContainEqual(result.reasons);
    } else expect(result.reasons).toEqual([]);
  }, 30_000);
});
