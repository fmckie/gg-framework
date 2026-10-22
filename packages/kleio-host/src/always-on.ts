// Is this computer always on? GET /kleio/host's "alwaysOn" (host-info.ts).
// Kleio lives on the host, so a host that sleeps takes every device with it.
//
// Read-only: it runs each OS's own power tool by absolute path (run-file.ts:
// an argument array, no shell, 5 s each, 256 KiB of output at most) and reads
// sysfs on Linux. It never changes a setting. What the programs print goes to
// the host log only; the answer is a state plus codes from a fixed list.
//
//   yes        stays on: set never to sleep on AC power (no reasons)
//   may_sleep  set to sleep, or not to come back by itself (at least one reason)
//   laptop     has a battery, so it sleeps when the lid closes (no reasons)
//   unknown    check_failed, or unsupported_os (an OS this doesn't check)
//
// macOS    /usr/bin/pmset -g batt: an "-InternalBattery-N" line is a laptop (a
//          UPS's line isn't). Else pmset -g custom, its "AC Power:" section
//          only: sleep not 0 is sleeps_on_ac, autorestart 0 no_autorestart,
//          womp 0 no_wake_for_network. A Mac without autorestart or womp
//          doesn't have that setting, so it isn't flagged.
// Windows  reg.exe query HKLM\…\Enum\ACPI\PNP0C0A: exit 0 is an ACPI battery,
//          a laptop; exit 1 is none. Then powercfg.exe /query SCHEME_CURRENT
//          SUB_SLEEP STANDBYIDLE: the AC index is "sleep after" in seconds,
//          0 is never; anything else is sleeps_on_ac.
// Linux    a sysfs power supply of type Battery whose scope isn't Device (a
//          mouse's or a UPS's) is a laptop. systemctl get-default other than
//          graphical.target is a server with no desktop to suspend it: yes.
//          Else systemctl is-enabled sleep.target: masked is yes, any other
//          state sleep_not_masked.

import { readdir, readFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import type { Result } from "./result.js";
import {
  ranLine,
  runFile,
  runOptions,
  windowsSystem32,
  type RunFailure,
  type RunFile,
  type RunOutput,
} from "./run-file.js";

export const ALWAYS_ON_STATES = ["yes", "may_sleep", "laptop", "unknown"] as const;
export type AlwaysOnState = (typeof ALWAYS_ON_STATES)[number];

export const ALWAYS_ON_REASONS = [
  "sleeps_on_ac",
  "no_autorestart",
  "no_wake_for_network",
  "sleep_not_masked",
  "check_failed",
  "unsupported_os",
] as const;
export type AlwaysOnReason = (typeof ALWAYS_ON_REASONS)[number];

export interface AlwaysOn {
  readonly state: AlwaysOnState;
  readonly reasons: readonly AlwaysOnReason[];
}

/** What each program gets: 5 s, 256 KiB of output. */
export const ALWAYS_ON_RUN = runOptions(5_000, 256 * 1024);

export const PMSET = "/usr/bin/pmset";
/** Tried in order: the first one that starts is the one used. */
export const SYSTEMCTL_PATHS = ["/usr/bin/systemctl", "/bin/systemctl"] as const;
/** ACPI's Control Method Battery: a key Windows makes only where it found a battery. */
export const WINDOWS_BATTERY_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Enum\\ACPI\\PNP0C0A";

/** systemctl is-enabled's documented answers (systemctl(1)). */
const UNIT_FILE_STATES: readonly string[] = [
  "enabled",
  "enabled-runtime",
  "linked",
  "linked-runtime",
  "alias",
  "masked",
  "masked-runtime",
  "static",
  "indirect",
  "disabled",
  "generated",
  "transient",
  "bad",
  "not-found",
];

const SCOPE = "[host] alwaysOn";

const laptop = (): AlwaysOn => ({ state: "laptop", reasons: [] });
const failed = (): AlwaysOn => ({ state: "unknown", reasons: ["check_failed"] });
/** No reasons is yes; any reason is may_sleep. */
const settled = (reasons: AlwaysOnReason[]): AlwaysOn =>
  reasons.length > 0 ? { state: "may_sleep", reasons } : { state: "yes", reasons: [] };

/** `pmset -g batt`: whether it lists the Mac's own battery (a UPS's line doesn't count). */
export function pmsetHasInternalBattery(batt: string): boolean {
  return /^\s*-InternalBattery-\d+/m.test(batt);
}

/**
 * `pmset -g custom`: the numeric settings in its "AC Power:" section, by name,
 * or null when it has no such section. Other sections are skipped.
 */
export function parsePmsetAc(custom: string): ReadonlyMap<string, number> | null {
  const settings = new Map<string, number>();
  let section: string | undefined;
  let found = false;
  for (const line of custom.split(/\r?\n/)) {
    // Section headers start at column 0 ("AC Power:"); settings are indented.
    if (/^\S/.test(line)) {
      section = line.trim();
      if (section === "AC Power:") found = true;
      continue;
    }
    if (section !== "AC Power:") continue;
    // Names can have spaces ("Sleep On Power Button 1"); non-numbers are skipped.
    const m = /^\s+(\S(?:.*?\S)?)\s+(\d+)(?:\s.*)?$/.exec(line);
    const name = m?.[1];
    const value = m?.[2];
    if (name !== undefined && value !== undefined && !settings.has(name)) {
      settings.set(name, Number(value));
    }
  }
  return found ? settings : null;
}

/** A desktop Mac's answer from `pmset -g custom` (a laptop stops at `pmset -g batt`). */
export function pmsetVerdict(custom: string): AlwaysOn {
  const ac = parsePmsetAc(custom);
  const sleep = ac?.get("sleep");
  if (!ac || sleep === undefined) return failed();
  const reasons: AlwaysOnReason[] = [];
  if (sleep !== 0) reasons.push("sleeps_on_ac");
  if (ac.get("autorestart") === 0) reasons.push("no_autorestart");
  if (ac.get("womp") === 0) reasons.push("no_wake_for_network");
  return settled(reasons);
}

/**
 * `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE`: "sleep after" on AC
 * power, in seconds (0 is never), or null. Windows translates the labels, so
 * without the English one, output with exactly five 0x values (minimum,
 * maximum, step, AC, DC) gives the fourth.
 */
export function parsePowercfgAc(query: string): number | null {
  let value: string | undefined;
  const labelled = /Current AC Power Setting Index:[ \t]*(\S*)/.exec(query);
  if (labelled) value = labelled[1];
  else {
    const all = query.match(/\b0x[0-9a-f]+\b/gi);
    if (all?.length === 5) value = all[3];
  }
  if (value === undefined || !/^0x[0-9a-f]{1,8}$/i.test(value)) return null;
  return Number.parseInt(value.slice(2), 16);
}

/** A Windows PC's answer from powercfg (a laptop stops at the battery key). */
export function powercfgVerdict(query: string): AlwaysOn {
  const seconds = parsePowercfgAc(query);
  if (seconds === null) return failed();
  return settled(seconds === 0 ? [] : ["sleeps_on_ac"]);
}

/** systemctl's answer: its first line, trimmed ("" when it printed nothing). */
export function systemctlWord(stdout: string): string {
  return (stdout.split(/\r?\n/)[0] ?? "").trim();
}

/** A Linux desktop's answer from `systemctl is-enabled sleep.target` (stdout, any exit code). */
export function sleepTargetVerdict(isEnabled: string): AlwaysOn {
  const word = systemctlWord(isEnabled);
  if (word === "masked" || word === "masked-runtime") return settled([]);
  return UNIT_FILE_STATES.includes(word) ? settled(["sleep_not_masked"]) : failed();
}

export interface AlwaysOnOptions {
  /** process.platform, or a test's. */
  readonly platform: string;
  /** For %SystemRoot% on Windows. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Test seam. Default: run-file.ts. */
  readonly run?: RunFile;
  /** Where Linux's /sys is found. Default "/" (a test's fake tree otherwise). */
  readonly sysfsRoot?: string;
  /** The host log: each program's file, args, exit code and output, and the answer. */
  readonly log?: (msg: string) => void;
}

/** The check for this OS. Never throws: anything unexpected is unknown / check_failed. */
export async function checkAlwaysOn(options: AlwaysOnOptions): Promise<AlwaysOn> {
  const log = options.log ?? ((): void => {});
  const run = options.run ?? runFile;
  const call = async (
    file: string,
    args: readonly string[],
  ): Promise<Result<RunOutput, RunFailure>> => {
    const r = await run(file, args, ALWAYS_ON_RUN);
    log(
      r.ok
        ? ranLine(SCOPE, file, args, r.value)
        : `${SCOPE} ${file} ${JSON.stringify(args)} failed: ${r.error.message}`,
    );
    return r;
  };

  const mac = async (): Promise<AlwaysOn> => {
    const batt = await call(PMSET, ["-g", "batt"]);
    if (!batt.ok || batt.value.exitCode !== 0) return failed();
    if (pmsetHasInternalBattery(batt.value.stdout)) return laptop();
    const custom = await call(PMSET, ["-g", "custom"]);
    if (!custom.ok || custom.value.exitCode !== 0) return failed();
    return pmsetVerdict(custom.value.stdout);
  };

  const windows = async (): Promise<AlwaysOn> => {
    const system32 = windowsSystem32(options.env);
    const battery = await call(win32.join(system32, "reg.exe"), ["query", WINDOWS_BATTERY_KEY]);
    if (!battery.ok) return failed();
    if (battery.value.exitCode === 0) return laptop();
    if (battery.value.exitCode !== 1) return failed();
    const query = await call(win32.join(system32, "powercfg.exe"), [
      "/query",
      "SCHEME_CURRENT",
      "SUB_SLEEP",
      "STANDBYIDLE",
    ]);
    if (!query.ok || query.value.exitCode !== 0) return failed();
    return powercfgVerdict(query.value.stdout);
  };

  const linux = async (): Promise<AlwaysOn> => {
    const battery = await linuxHasBattery(options.sysfsRoot ?? "/", log);
    if (battery === null) return failed();
    if (battery) return laptop();
    let systemctl: string | undefined;
    let target: RunOutput | undefined;
    for (const file of SYSTEMCTL_PATHS) {
      const r = await call(file, ["get-default"]);
      if (r.ok) {
        systemctl = file;
        target = r.value;
        break;
      }
      if (r.error.kind !== "spawn_failed") break;
    }
    if (systemctl === undefined || target === undefined || target.exitCode !== 0) return failed();
    const unit = systemctlWord(target.stdout);
    if (unit === "") return failed();
    if (unit !== "graphical.target") return settled([]);
    // is-enabled exits 1 for masked (and disabled): its answer is on stdout.
    const enabled = await call(systemctl, ["is-enabled", "sleep.target"]);
    return enabled.ok ? sleepTargetVerdict(enabled.value.stdout) : failed();
  };

  let result: AlwaysOn;
  try {
    switch (options.platform) {
      case "darwin":
        result = await mac();
        break;
      case "win32":
        result = await windows();
        break;
      case "linux":
        result = await linux();
        break;
      default:
        result = { state: "unknown", reasons: ["unsupported_os"] };
    }
  } catch (e) {
    log(`${SCOPE} check threw: ${e instanceof Error ? e.message : String(e)}`);
    result = failed();
  }
  log(`${SCOPE} ${result.state} [${result.reasons.join(", ")}]`);
  return result;
}

/**
 * Linux: whether sysfs lists a battery of the computer's own, i.e. a power
 * supply of type Battery whose scope isn't Device. No power_supply folder is
 * no battery; one that can't be read is null (the check failed).
 */
async function linuxHasBattery(
  sysfsRoot: string,
  log: (msg: string) => void,
): Promise<boolean | null> {
  const dir = join(sysfsRoot, "sys", "class", "power_supply");
  let names: string[];
  try {
    names = (await readdir(dir)).sort();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    log(`${SCOPE} can't list ${dir} (${code ?? "error"})`);
    return null;
  }
  for (const name of names) {
    if ((await readWord(join(dir, name, "type"))) !== "Battery") continue;
    if ((await readWord(join(dir, name, "scope"))) === "Device") continue;
    log(`${SCOPE} battery ${JSON.stringify(name)}`);
    return true;
  }
  return false;
}

/** A sysfs attribute's text, trimmed, or undefined when it can't be read. */
async function readWord(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return undefined;
  }
}
