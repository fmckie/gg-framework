// Dictation (iPhone and Mac), the button's state machine: tap to record, tap
// again (or hit the 2-minute limit, or leave the app) to stop; the clip is
// transcribed with Whisper on the Mac (the paired one, from the iPhone) and
// the text lands in the composer.

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeDictation } from "./agent";
import { isPhone } from "./platform";
import { DICTATION_MAX_MS, startRecording, type Recording } from "./dictation-recorder";

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

export interface UseDictationOptions {
  /** Called with the transcript; never called with empty text. */
  onText: (text: string) => void;
  /** A user-facing message for a failure or a clip with no speech. */
  onError: (message: string) => void;
  /** Clock for the elapsed timer (injectable for tests). */
  now?: () => number;
}

export interface UseDictation {
  phase: DictationPhase;
  /** Milliseconds recorded so far; 0 unless recording. */
  elapsedMs: number;
  /** Start when idle, stop and transcribe when recording, else nothing. */
  toggle: () => void;
}

const START_ERRORS = {
  unsupported: "Dictation isn't available here.",
  unavailable: "Couldn't start the microphone.",
} as const;

/** Where to grant the microphone: the iPhone's Settings app, or macOS's. */
function deniedMessage(): string {
  return isPhone()
    ? "Kleio needs the microphone. Turn it on in Settings, then Kleio."
    : "Kleio needs the microphone. Turn it on in System Settings > Privacy & Security > Microphone.";
}

export function useDictation({
  onText,
  onError,
  now = Date.now,
}: UseDictationOptions): UseDictation {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const phaseRef = useRef<DictationPhase>("idle");
  const recordingRef = useRef<Recording | null>(null);
  const timersRef = useRef<{ tick: number; limit: number } | null>(null);
  const aliveRef = useRef(true);
  // Latest callbacks for the async paths, synced in an effect (not during
  // render) so `toggle` stays stable.
  const handlers = useRef({ onText, onError, now });
  useEffect(() => {
    handlers.current = { onText, onError, now };
  });

  const enter = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    if (aliveRef.current) setPhase(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (!timersRef.current) return;
    window.clearInterval(timersRef.current.tick);
    window.clearTimeout(timersRef.current.limit);
    timersRef.current = null;
  }, []);

  const finish = useCallback(async () => {
    const recording = recordingRef.current;
    if (phaseRef.current !== "recording" || !recording) return;
    recordingRef.current = null;
    clearTimers();
    setElapsedMs(0);
    enter("transcribing");
    try {
      const text = (await transcribeDictation(await recording.stop())).trim();
      if (!aliveRef.current) return;
      if (text) handlers.current.onText(text);
      else handlers.current.onError("Didn't catch any speech. Try again.");
    } catch (err) {
      if (aliveRef.current)
        handlers.current.onError(err instanceof Error ? err.message : String(err));
    } finally {
      enter("idle");
    }
  }, [clearTimers, enter]);

  const start = useCallback(async () => {
    enter("starting");
    const started = await startRecording();
    if (!started.ok) {
      if (aliveRef.current)
        handlers.current.onError(
          started.error === "denied" ? deniedMessage() : START_ERRORS[started.error],
        );
      enter("idle");
      return;
    }
    if (!aliveRef.current) {
      started.value.cancel();
      return;
    }
    recordingRef.current = started.value;
    const startedAt = handlers.current.now();
    setElapsedMs(0);
    timersRef.current = {
      tick: window.setInterval(() => setElapsedMs(handlers.current.now() - startedAt), 250),
      limit: window.setTimeout(() => void finish(), DICTATION_MAX_MS),
    };
    enter("recording");
  }, [enter, finish]);

  const toggle = useCallback(() => {
    if (phaseRef.current === "idle") void start();
    else if (phaseRef.current === "recording") void finish();
  }, [finish, start]);

  // iOS mutes the microphone once the app leaves the screen: keep what was said.
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === "hidden") void finish();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [finish]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimers();
      recordingRef.current?.cancel();
      recordingRef.current = null;
    };
  }, [clearTimers]);

  return { phase, elapsedMs, toggle };
}
