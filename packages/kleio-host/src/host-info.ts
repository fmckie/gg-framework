// GET /kleio/host, for any paired device: which OS the host runs, Kleio's
// version, and whether the host stays on (always-on.ts).
//
//   { "os": "darwin", "version": "2.1.3",
//     "alwaysOn": { "state": "yes", "reasons": [] } }
//
// The always-on check starts programs, so its answer is kept for a minute and
// calls that arrive while one runs share it: a device can't make the host
// start programs in a loop. Their raw output goes to the host log only.

import { checkAlwaysOn, type AlwaysOn } from "./always-on.js";
import { isPlatformWord } from "./dictation-setup.js";
import type { RunFile } from "./run-file.js";
import { KLEIO_VERSION } from "./version.js";

export interface HostInfo {
  readonly os: string;
  readonly version: string;
  readonly alwaysOn: AlwaysOn;
}

/** How long an always-on answer is kept (ms). */
export const HOST_INFO_CACHE_MS = 60_000;

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
}

export interface HostInfoOptions extends HostInfoSeams {
  readonly log?: (msg: string) => void;
}

export interface HostInfoReader {
  read(): Promise<HostInfo>;
}

export function createHostInfo(options: HostInfoOptions = {}): HostInfoReader {
  const platform = options.platform ?? process.platform;
  const os = isPlatformWord(platform) ? platform : "unknown";
  const version = options.version ?? KLEIO_VERSION;
  const cacheMs = options.cacheMs ?? HOST_INFO_CACHE_MS;
  const now = options.now ?? Date.now;
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

  return {
    read: async () => ({ os, version, alwaysOn: await alwaysOn() }),
  };
}
