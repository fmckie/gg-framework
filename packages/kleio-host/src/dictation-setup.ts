/**
 * Dictation's step in Settings → Setup (GET/POST /kleio/setup/dictation).
 *
 * Whisper runs in the sidecar, one for every paired device, and so does the
 * download of its speech model. The host asks the sidecar where the model is
 * (GET /dictation) or to get it ready (POST /dictation/prepare), checks the
 * answer, and passes on only the fields it knows: a state, sizes, a reason
 * code, the platform. The details of a failure stay in the sidecar's log.
 */

import type { SidecarCall } from "./pinned-thread.js";
import { err, ok, type Result } from "./result.js";

export const DICTATION_FAILURES = [
  "offline",
  "server",
  "missing",
  "storage",
  "integrity",
  "load",
] as const;

export type DictationFailure = (typeof DICTATION_FAILURES)[number];

/** Where the host's speech model is. `bytes` is the whole model's size. */
export type DictationSetup =
  | { readonly state: "absent"; readonly bytes: number }
  | { readonly state: "downloading"; readonly loaded: number; readonly bytes: number }
  | { readonly state: "loading"; readonly bytes: number }
  | { readonly state: "ready"; readonly bytes: number }
  | { readonly state: "failed"; readonly reason: DictationFailure; readonly bytes: number }
  | {
      readonly state: "unsupported";
      readonly os: string;
      readonly arch: string;
      readonly bytes: number;
    };

/** The POST carries nothing the host reads. */
export const DICTATION_SETUP_MAX_BODY = 1024;

const ASK_TIMEOUT_MS = 3_000;
/** process.platform and process.arch values: "darwin", "x64", "arm64"… */
const PLATFORM_WORD = /^[a-z0-9_]{1,16}$/;

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const isFailure = (v: unknown): v is DictationFailure =>
  typeof v === "string" && (DICTATION_FAILURES as readonly string[]).includes(v);

/** A process.platform or process.arch value (also GET /kleio/host's `os`). */
export const isPlatformWord = (v: unknown): v is string =>
  typeof v === "string" && PLATFORM_WORD.test(v);

/** The sidecar's answer, checked: a known state with only its known fields, else null. */
export function parseDictationSetup(body: unknown): DictationSetup | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const bytes = b.bytes;
  if (!isCount(bytes)) return null;
  switch (b.state) {
    case "absent":
    case "loading":
    case "ready":
      return { state: b.state, bytes };
    case "downloading":
      return isCount(b.loaded) && b.loaded <= bytes
        ? { state: "downloading", loaded: b.loaded, bytes }
        : null;
    case "failed":
      return isFailure(b.reason) ? { state: "failed", reason: b.reason, bytes } : null;
    case "unsupported":
      return isPlatformWord(b.os) && isPlatformWord(b.arch)
        ? { state: "unsupported", os: b.os, arch: b.arch, bytes }
        : null;
    default:
      return null;
  }
}

/** The sidecar couldn't be reached in time, or its answer didn't check out. */
export type DictationSetupError = "engine_unavailable";

export interface DictationSetupRoutes {
  /** Where the model is. */
  status(): Promise<Result<DictationSetup, DictationSetupError>>;
  /**
   * Start getting the model ready, or join the run under way. `started`: the
   * state moved, so a run began (asking again mid-download changes nothing).
   */
  prepare(): Promise<
    Result<{ readonly dictation: DictationSetup; readonly started: boolean }, DictationSetupError>
  >;
}

export function createDictationSetup(call: SidecarCall): DictationSetupRoutes {
  const ask = async (method: "GET" | "POST", path: string): Promise<DictationSetup | null> => {
    const reply = await call(method, path, { timeoutMs: ASK_TIMEOUT_MS });
    if (reply?.status !== 200) return null;
    try {
      return parseDictationSetup(JSON.parse(reply.body));
    } catch {
      return null;
    }
  };
  return {
    async status() {
      const now = await ask("GET", "/dictation");
      return now ? ok(now) : err("engine_unavailable");
    },
    async prepare() {
      const before = await ask("GET", "/dictation");
      const after = await ask("POST", "/dictation/prepare");
      if (!after) return err("engine_unavailable");
      return ok({ dictation: after, started: before?.state !== after.state });
    },
  };
}
