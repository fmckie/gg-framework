// Settings → Setup: dictation, one of the optional steps. Whisper runs on the
// host for every paired device; its speech model downloads once, started here
// or by the first recording. Any paired device can start it (dictating already
// does), and every device sees the same progress, as the card polls the host
// while it works.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DictateButton } from "../DictateButton";
import { supportsDictation } from "../platform";
import { SettingsCard } from "../settings-section";
import { useDictation } from "../useDictation";
import {
  getDictationSetup,
  KleioApiError,
  startDictationSetup,
  type DictationFailure,
  type DictationSetup,
} from "./kleioApi";
import { StepBadge, type StepMark } from "./StepBadge";

/** How often the card asks while the host downloads or loads the model. */
export const DICTATION_POLL_MS = 1_000;
/** Missed checks in a row before a shown status gives way to "Can't check". */
const MISSES_TO_GIVE_UP = 2;

type Load =
  | { kind: "checking" }
  | { kind: "status"; status: DictationSetup }
  /** A host from before this step (403 or 404). */
  | { kind: "old" }
  /** The host answered, but its engine didn't (503). */
  | { kind: "engine-down" }
  /** No answer, or one this app can't read. */
  | { kind: "error" };

/** Whole megabytes, as the card shows sizes. */
const mb = (bytes: number): number => Math.round(bytes / 1_000_000);

/** The host, in words: "the speech engine doesn't work on …". */
function hostMachine(os: string, arch: string): string {
  if (os === "darwin") return arch === "x64" ? "a Mac with an Intel chip" : "this Mac";
  if (os === "linux") return "this Linux computer";
  if (os === "win32") return "this Windows PC";
  return "this computer";
}

/** Why the host couldn't get the model ready, in plain words. Never a raw error. */
export function dictationFailureText(reason: DictationFailure, bytes: number): string {
  switch (reason) {
    case "offline":
      return "Your host couldn't reach Hugging Face, where the speech model comes from. Check the host's internet connection, then try again.";
    case "server":
      return "Hugging Face had a problem. Try again in a few minutes.";
    case "missing":
      return "This version of Kleio asks for a speech model that's no longer available. Update Kleio on your host.";
    case "storage":
      return `Your host couldn't save the speech model. It needs ${mb(bytes)} MB free, and Kleio must be able to write to its home folder.`;
    case "integrity":
      return "The download didn't match what Kleio expects, so it was thrown away. Try again.";
    case "load":
      return "Your host couldn't start dictation. Its log says why.";
  }
}

function loadFromError(e: unknown): Load {
  if (e instanceof KleioApiError) {
    // A host before this step: 404 for an admin device, 403 for any other.
    if (e.status === 403 || e.status === 404) return { kind: "old" };
    if (e.status === 503) return { kind: "engine-down" };
  }
  return { kind: "error" };
}

/** The host polls only while it works on the model. */
const working = (load: Load): boolean =>
  load.kind === "status" &&
  (load.status.state === "downloading" || load.status.state === "loading");

/** What a screen reader hears when the state changes; never each percent. */
function announcement(status: DictationSetup): string {
  switch (status.state) {
    case "downloading":
      return "Downloading the speech model.";
    case "loading":
      return "Getting dictation ready.";
    case "ready":
      return "Dictation is ready.";
    case "failed":
      return dictationFailureText(status.reason, status.bytes);
    case "unsupported":
      return "Your host can't run dictation.";
    case "absent":
      return "";
  }
}

/**
 * The host's dictation status, kept fresh: once on open, about once a second
 * while the host works, and again when the app comes back to the front. A
 * hidden page asks nothing. The newest request wins, so a slow check can't
 * undo a download just started.
 */
function useHostDictation(): {
  load: Load;
  starting: boolean;
  start: () => Promise<void>;
  recheck: () => Promise<void>;
} {
  const [load, setLoad] = useState<Load>({ kind: "checking" });
  const [starting, setStarting] = useState(false);
  const latest = useRef(0);
  const inFlight = useRef(false);
  const misses = useRef(0);
  const alive = useRef(true);

  const show = useCallback((status: DictationSetup) => {
    misses.current = 0;
    setLoad((prev) =>
      // The bar never goes back: a slower answer can't undo progress shown.
      status.state === "downloading" &&
      prev.kind === "status" &&
      prev.status.state === "downloading"
        ? {
            kind: "status",
            status: { ...status, loaded: Math.max(status.loaded, prev.status.loaded) },
          }
        : { kind: "status", status },
    );
  }, []);

  /** An automatic check: a blip keeps what's shown until it happens twice. */
  const check = useCallback(async (): Promise<void> => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    const id = ++latest.current;
    try {
      const status = await getDictationSetup();
      if (alive.current && id === latest.current) show(status);
    } catch (e) {
      if (!alive.current || id !== latest.current) return;
      misses.current += 1;
      setLoad((prev) =>
        prev.kind === "status" && misses.current < MISSES_TO_GIVE_UP ? prev : loadFromError(e),
      );
    } finally {
      inFlight.current = false;
    }
  }, [show]);

  /** "Try again" on a check that failed: says so at once if it fails again. */
  const recheck = useCallback(async (): Promise<void> => {
    const id = ++latest.current;
    setLoad({ kind: "checking" });
    try {
      const status = await getDictationSetup();
      if (alive.current && id === latest.current) show(status);
    } catch (e) {
      if (alive.current && id === latest.current) setLoad(loadFromError(e));
    }
  }, [show]);

  const start = useCallback(async (): Promise<void> => {
    const id = ++latest.current;
    setStarting(true);
    try {
      const status = await startDictationSetup();
      if (alive.current && id === latest.current) show(status);
    } catch (e) {
      if (alive.current && id === latest.current) setLoad(loadFromError(e));
    } finally {
      if (alive.current) setStarting(false);
    }
  }, [show]);

  useEffect(() => {
    alive.current = true;
    void check();
    const again = (): void => void check();
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [check]);

  const polling = working(load);
  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => void check(), DICTATION_POLL_MS);
    return () => window.clearInterval(id);
  }, [polling, check]);

  return { load, starting, start, recheck };
}

/** The download so far: what it's doing and how much, over a bar. */
function DownloadProgress({
  loaded,
  bytes,
}: {
  loaded: number;
  bytes: number;
}): React.ReactElement {
  const id = useId();
  const percent = bytes > 0 ? Math.min(100, Math.floor((loaded / bytes) * 100)) : 0;
  const size = `${Math.min(Math.floor(loaded / 1_000_000), mb(bytes))} of ${mb(bytes)} MB`;
  return (
    <div className="setup-download">
      <div className="setup-download-head">
        <p className="settings-desc" id={`${id}-label`}>
          Downloading the speech model…
        </p>
        <p className="settings-desc setup-download-size" aria-hidden="true">
          {size}
        </p>
      </div>
      <div
        className="setup-download-bar"
        role="progressbar"
        aria-labelledby={`${id}-label`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={size}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="settings-desc">You can leave this page; your host keeps downloading.</p>
    </div>
  );
}

/** Try it: the chat box's own mic, so the first tap also asks for the microphone. */
function TryIt(): React.ReactElement {
  const [heard, setHeard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dictation = useDictation({
    onText: (text) => {
      setError(null);
      setHeard(text);
    },
    onError: (message) => {
      setHeard(null);
      setError(message);
    },
  });
  const { phase } = dictation;
  return (
    <div className="setup-dictation-try">
      <div className="setup-dictation-try-row">
        <DictateButton dictation={dictation} />
        <p className="settings-desc" role="status">
          {phase === "recording"
            ? "Listening… Tap the mic again when you're done."
            : phase === "transcribing"
              ? "Transcribing…"
              : "Try it: tap the mic, say something, then tap it again."}
        </p>
      </div>
      {heard !== null && <p className="settings-desc">{`Heard: “${heard}”`}</p>}
      {error && (
        <p className="settings-desc is-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * `canTry`: this device has dictation (iPhone and Mac), so the ready card
 * offers Try it; elsewhere it says where dictation is.
 */
export function DictationCard({
  canTry = supportsDictation(),
}: {
  canTry?: boolean;
}): React.ReactElement {
  const { load, starting, start, recheck } = useHostDictation();
  const [said, setSaid] = useState("");
  const shown = useRef<DictationSetup["state"] | null>(null);

  // Announce a change of state the card saw happen, not the state it opened on.
  const state = load.kind === "status" ? load.status : null;
  useEffect(() => {
    if (!state) return;
    if (shown.current !== null && shown.current !== state.state) setSaid(announcement(state));
    shown.current = state.state;
  }, [state]);

  const mark: StepMark =
    load.kind === "checking"
      ? "checking"
      : load.kind !== "status"
        ? "unknown"
        : {
            absent: "optional" as const,
            downloading: "working" as const,
            loading: "working" as const,
            ready: "done" as const,
            failed: "optional" as const,
            unsupported: "unavailable" as const,
          }[load.status.state];

  const blurb =
    "Speak instead of typing in any chat box. Your host turns speech into text itself, so recordings never leave your devices and host.";

  return (
    <SettingsCard
      title="Dictation"
      subtitle="Whisper, on your host"
      badge={<StepBadge mark={mark} />}
      description={
        state?.state === "absent"
          ? `${blurb} Needs a one-time download of ${mb(state.bytes)} MB on the host.`
          : blurb
      }
    >
      {load.kind === "old" ? (
        <p className="settings-desc">
          Your host needs the latest Kleio to set up dictation here. Dictation still works: the
          first recording downloads what it needs.
        </p>
      ) : load.kind === "engine-down" || load.kind === "error" ? (
        <div className="setup-status">
          <p className="settings-desc">
            {load.kind === "engine-down"
              ? "Couldn't reach the engine on your host."
              : "Couldn't check dictation on your host."}
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => void recheck()}>
            Try again
          </button>
        </div>
      ) : state === null ? null : state.state === "absent" ? (
        <div className="modal-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={starting}
            onClick={() => void start()}
          >
            {starting ? "Starting…" : `Download speech model (${mb(state.bytes)} MB)`}
          </button>
        </div>
      ) : state.state === "downloading" ? (
        <DownloadProgress loaded={state.loaded} bytes={state.bytes} />
      ) : state.state === "loading" ? (
        <p className="settings-desc">Getting dictation ready…</p>
      ) : state.state === "ready" ? (
        canTry ? (
          <>
            <p className="settings-desc">Ready. Tap the mic in any chat box.</p>
            <TryIt />
          </>
        ) : (
          <p className="settings-desc">Ready. Dictation is in Kleio on iPhone and Mac.</p>
        )
      ) : state.state === "failed" ? (
        <div className="setup-status">
          <p className="settings-desc">{dictationFailureText(state.reason, state.bytes)}</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={starting}
            onClick={() => void start()}
          >
            {starting ? "Starting…" : "Try again"}
          </button>
        </div>
      ) : (
        <p className="settings-desc">
          {`Your host can't run dictation: the speech engine doesn't work on ${hostMachine(state.os, state.arch)}.`}
        </p>
      )}
      <p className="sr-only" role="status">
        {said}
      </p>
    </SettingsCard>
  );
}
