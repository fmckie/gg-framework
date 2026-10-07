// "Talk to Kleio": a live conversation with her natural voice (voiceCall.ts).
// One small panel over any screen, like the briefing: a breathing orb, live
// captions, mute and hang up. Opened from the home screen's button, the menu
// bar or ⌘⇧B once her voice is set up (Settings → Kleio's voice).

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PhoneDisconnectIcon,
  XIcon,
} from "@phosphor-icons/react";
import { getVoiceStatus } from "./kleioApi";
import { briefMe } from "./BriefPanel";
import {
  endCall,
  partialLines,
  resetCall,
  setMuted,
  startCall,
  useCall,
  type CallPhase,
} from "./voiceCall";

// ── Whether her voice is set up (cached; Settings refreshes it) ────────────

let voiceReady: boolean | null = null;
const readyListeners = new Set<() => void>();

export function setVoiceReady(ready: boolean): void {
  voiceReady = ready;
  for (const l of readyListeners) l();
}

/** Asks the Mac mini once; a host without voice counts as not set up. */
export async function refreshVoiceReady(): Promise<boolean> {
  try {
    setVoiceReady((await getVoiceStatus()).ready);
  } catch {
    setVoiceReady(false);
  }
  return voiceReady === true;
}

export function useVoiceReady(): boolean | null {
  return useSyncExternalStore(
    (l) => {
      readyListeners.add(l);
      return () => readyListeners.delete(l);
    },
    () => voiceReady,
  );
}

/**
 * Talk to Kleio when her voice is set up; otherwise the spoken briefing.
 * Call it straight from a tap, click or menu (the microphone asks then).
 */
export async function talkToKleio(): Promise<void> {
  const ready = voiceReady ?? (await refreshVoiceReady());
  if (ready) await startCall();
  else await briefMe();
}

const TITLE: Record<CallPhase, string> = {
  idle: "Kleio",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Kleio is speaking",
  ended: "Conversation ended",
};

export function TalkPanel(): React.ReactElement | null {
  const call = useCall();
  const open = call.phase !== "idle";
  const end = useRef<HTMLDivElement>(null);
  const inCall = call.phase !== "idle" && call.phase !== "ended";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") resetCall();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Keep the newest caption in view.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [call.lines.length, call.phase]);

  if (!open) return null;
  const partial = partialLines();

  return (
    <section className="brief-panel talk-panel" aria-label="Talking to Kleio">
      <header className="brief-head">
        <span
          className={`brief-orb${call.phase === "speaking" ? " is-speaking" : ""}${call.phase === "listening" ? " is-listening" : ""}`}
          aria-hidden="true"
        >
          <span />
          <span />
          <span />
        </span>
        <h2 className="brief-title" aria-live="polite">
          {call.muted && inCall ? "Muted" : TITLE[call.phase]}
        </h2>
        <button
          type="button"
          className="icon-circle brief-close"
          aria-label="Close"
          title="Close (Esc)"
          onClick={resetCall}
        >
          <XIcon size={16} weight="bold" aria-hidden="true" />
        </button>
      </header>
      <div className="talk-lines">
        {call.lines.length === 0 && partial.length === 0 && call.phase === "connecting" && (
          <p className="brief-text is-muted">Getting Kleio on the line…</p>
        )}
        {[...call.lines, ...partial].map((l, i) => (
          <p key={i} className={`talk-line is-${l.who}`}>
            {l.text}
          </p>
        ))}
        {call.error && (
          <p className="brief-text is-error" role="alert">
            {call.error}
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="brief-actions">
        {inCall ? (
          <>
            <button
              type="button"
              className="btn btn-ghost brief-action"
              aria-pressed={call.muted}
              onClick={() => setMuted(!call.muted)}
            >
              {call.muted ? (
                <MicrophoneIcon size={16} weight="bold" aria-hidden="true" />
              ) : (
                <MicrophoneSlashIcon size={16} weight="bold" aria-hidden="true" />
              )}
              {call.muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              className="btn btn-ghost brief-action is-hangup"
              onClick={() => endCall()}
            >
              <PhoneDisconnectIcon size={16} weight="fill" aria-hidden="true" />
              Hang up
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost brief-action"
            onClick={() => void startCall()}
          >
            <MicrophoneIcon size={16} weight="bold" aria-hidden="true" />
            Talk again
          </button>
        )}
      </div>
    </section>
  );
}
