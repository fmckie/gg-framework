// GET /kleio/host, for any paired device: which OS the host runs, Kleio's
// version, whether the host stays on (always-on.ts), and whether the engine
// is keeping it awake for a run right now.
//
//   { "os": "darwin", "version": "2.1.3",
//     "alwaysOn": { "state": "yes", "reasons": [] }, "keepAwake": "idle" }
//
// The always-on check starts programs, so its answer is kept for a minute and
// calls that arrive while one runs share it: a device can't make the host
// start programs in a loop. Their raw output goes to the host log only.
//
// keepAwake is the engine's GET /keep-awake, asked on every call with a short
// timeout and never kept (it changes with each run):
//   - "holding": a run, Ken reply or sub-agent holds the idle-sleep assertion;
//   - "idle": the setting is on and nothing holds it (or the 6 h limit let go);
//   - "off": the setting is off;
//   - "unavailable": the engine didn't answer in time, or is too old to say.

import { checkAlwaysOn, type AlwaysOn } from "./always-on.js";
import { isPlatformWord } from "./dictation-setup.js";
import type { SidecarCall, SidecarReply } from "./pinned-thread.js";
import type { RunFile } from "./run-file.js";
import { KLEIO_VERSION } from "./version.js";

export type KeepAwakeState = "holding" | "idle" | "off" | "unavailable";

export interface HostInfo {
  readonly os: string;
  readonly version: string;
  readonly alwaysOn: AlwaysOn;
  readonly keepAwake: KeepAwakeState;
}

/** How long an always-on answer is kept (ms). */
export const HOST_INFO_CACHE_MS = 60_000;

/** How long GET /kleio/host waits for the engine's keep-awake answer (ms). */
export const KEEP_AWAKE_TIMEOUT_MS = 1_500;

/** Test seams (HostOptions.hostInfo); each defaults to the real thing. */
export interface HostInfoSeams {
  /** Default: KLEIO_VERSION (version.ts). */
  readonly version?: string;
  /** Default: process.platform. Both `os` and the check use it. */
  readonly platform?: string;
  /** Default: process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly run?: RunFile;
  readonly sysfsRoot?: string;
  readonly cacheMs?: number;
  readonly now?: () => number;
  /** Default: KEEP_AWAKE_TIMEOUT_MS. */
  readonly keepAwakeTimeoutMs?: number;
}

export interface HostInfoOptions extends HostInfoSeams {
  readonly log?: (msg: string) => void;
  /** Asks the engine (the host's sidecar call). Unset: keepAwake is "unavailable". */
  readonly engine?: SidecarCall;
}

export interface HostInfoReader {
  read(): Promise<HostInfo>;
}

/** The engine's GET /keep-awake answer, `{ enabled, holding }`, as a keepAwake state. */
export function keepAwakeState(reply: SidecarReply | null): KeepAwakeState {
  if (!reply || reply.status !== 200) return "unavailable";
  let body: unknown;
  try {
    body = JSON.parse(reply.body);
  } catch {
    return "unavailable";
  }
  if (typeof body !== "object" || body === null) return "unavailable";
  const { enabled, holding } = body as { enabled?: unknown; holding?: unknown };
  if (enabled === false) return "off";
  // An engine from before `holding` can't say whether it holds.
  if (enabled !== true || typeof holding !== "boolean") return "unavailable";
  return holding ? "holding" : "idle";
}

export function createHostInfo(options: HostInfoOptions = {}): HostInfoReader {
  const platform = options.platform ?? process.platform;
  const os = isPlatformWord(platform) ? platform : "unknown";
  const version = options.version ?? KLEIO_VERSION;
  const cacheMs = options.cacheMs ?? HOST_INFO_CACHE_MS;
  const now = options.now ?? Date.now;
  const keepAwakeTimeoutMs = options.keepAwakeTimeoutMs ?? KEEP_AWAKE_TIMEOUT_MS;
  let kept: { readonly at: number; readonly value: AlwaysOn } | undefined;
  let running: Promise<AlwaysOn> | undefined;

  const alwaysOn = (): Promise<AlwaysOn> => {
    const age = kept ? now() - kept.at : -1;
    if (kept && age >= 0 && age < cacheMs) return Promise.resolve(kept.value);
    // checkAlwaysOn never rejects: a failure is unknown / check_failed.
    running ??= checkAlwaysOn({
      platform,
      env: options.env ?? process.env,
      run: options.run,
      sysfsRoot: options.sysfsRoot,
      log: options.log,
    })
      .then((value) => {
        kept = { at: now(), value };
        return value;
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  };

  const keepAwake = async (): Promise<KeepAwakeState> => {
    const engine = options.engine;
    if (!engine) return "unavailable";
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A deadline of its own: the call's timeout is per socket, and a refused
    // call re-reads the endpoint and tries again.
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), keepAwakeTimeoutMs);
    });
    try {
      const reply = await Promise.race([
        engine("GET", "/keep-awake", { timeoutMs: keepAwakeTimeoutMs }).catch(() => null),
        late,
      ]);
      return keepAwakeState(reply);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    read: async () => {
      const [on, awake] = await Promise.all([alwaysOn(), keepAwake()]);
      return { os, version, alwaysOn: on, keepAwake: awake };
    },
  };
}
