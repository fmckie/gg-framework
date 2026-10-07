// "Talk to Kleio": the voice screen, inside the Kleio window (the whole screen
// on the iPhone). Kleio as a living orb in the middle that swells with her
// voice and settles when she's quiet; who's talking and live subtitles under
// her; mute and hang up at the bottom. Everything she and you said scrolls
// into the main chat afterwards, so this screen shows only the moment.
//
// Opened from the home screen's button, the menu bar or ⌘⇧B once her voice is
// set up (Settings → Kleio's voice). Esc or the close button leaves; the call
// ends with it.

import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PhoneDisconnectIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useDialogFocus } from "../dialog-focus";
import { HomeDither } from "../HomeDither";
import { useHomeBackgroundEnabled } from "../home-background";
import { getVoiceStatus } from "./kleioApi";
import { KLEIO_BACKGROUND, KLEIO_WAVES } from "./kleioWaves";
import { briefMe } from "./BriefPanel";
import {
  callLevels,
  endCall,
  partialLines,
  resetCall,
  setMuted,
  startCall,
  useCall,
  type CallPhase,
  type CallState,
} from "./voiceCall";
import type { OrbMood } from "./VoiceOrb";

// three.js loads with the first conversation, not with the app.
const VoiceOrb = lazy(() => import("./VoiceOrb").then((m) => ({ default: m.VoiceOrb })));

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

// ── What the screen says ───────────────────────────────────────────────────

const MOOD: Record<CallPhase, OrbMood> = {
  idle: "idle",
  connecting: "connecting",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  ended: "ended",
};

const STATUS: Record<OrbMood, string> = {
  idle: "Kleio",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  muted: "Muted",
  ended: "Call ended",
};

/** Plenty for the lines shown; the start of a long reply scrolls away. */
const CAPTION_MAX = 360;
/** Quiet this long while she listens: the words clear and the orb rests. */
export const CAPTION_HOLD_MS = 8_000;

export interface Caption {
  readonly who: "you" | "kleio";
  readonly text: string;
}

/** The end of `text`, from a word boundary: the newest words are what matter live. */
function latestWords(text: string): string {
  const t = text.trim();
  if (t.length <= CAPTION_MAX) return t;
  const tail = t.slice(-CAPTION_MAX);
  return tail.slice(tail.indexOf(" ") + 1);
}

/**
 * The words under the orb: hers as she says them; else whoever spoke last,
 * so your words show while she thinks about them.
 */
export function latestCaption(
  state: CallState,
  partial: readonly { who: string; text: string }[],
): Caption | null {
  const saying = [...partial].reverse().find((p) => p.who === "kleio" && p.text.trim());
  if (saying) return { who: "kleio", text: latestWords(saying.text) };
  const last = state.lines[state.lines.length - 1];
  if (!last?.text.trim()) return null;
  return { who: last.who, text: latestWords(last.text) };
}

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const m = matchMedia(query);
    const on = (): void => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * The words, cleared after a quiet spell while she listens, so the screen
 * rests. Re-renders only when the caption changes, not on every audio frame.
 */
function useCaption(call: CallState): Caption | null {
  const [caption, setCaption] = useState<Caption | null>(null);
  const shownAt = useRef(0);
  const shownKey = useRef("");
  useEffect(() => {
    const tick = (): void => {
      const c = latestCaption(call, partialLines());
      const key = c ? `${c.who}:${c.text}` : "";
      const now = Date.now();
      if (key !== shownKey.current) {
        shownKey.current = key;
        shownAt.current = now;
      }
      const stale = call.phase === "listening" && now - shownAt.current > CAPTION_HOLD_MS;
      const next = stale ? null : c;
      setCaption((prev) =>
        prev === next || (prev && next && prev.who === next.who && prev.text === next.text)
          ? prev
          : next,
      );
    };
    tick();
    // Her words arrive faster than React state changes: poll gently.
    const id = setInterval(tick, 120);
    return () => clearInterval(id);
  }, [call]);
  return caption;
}

/**
 * Live subtitles, a few lines at most, on a dark glass panel so they read
 * over the moving waves. Anchored to the newest line: a long reply rolls
 * upward, and only once it overflows does the top line fade.
 */
function Captions({ caption }: { readonly caption: Caption }): React.ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  const [rolling, setRolling] = useState(false);
  useLayoutEffect(() => {
    const b = box.current;
    const l = line.current;
    if (b && l) setRolling(l.offsetHeight > b.clientHeight + 1);
  }, [caption.text]);
  return (
    <div className={`voice-transcript is-${caption.who}`}>
      <div ref={box} className="voice-captions" data-rolling={rolling}>
        <p ref={line} className={`voice-line is-${caption.who}`}>
          {caption.who === "you" ? `“${caption.text}”` : caption.text}
        </p>
      </div>
    </div>
  );
}

/** A failed orb (lost GPU, no WebGL) leaves the screen working, just without it. */
class OrbBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): React.ReactNode {
    return this.state.failed ? <div className="voice-orb-fallback" /> : this.props.children;
  }
}

// ── The screen ─────────────────────────────────────────────────────────────

export function VoiceMode(): React.ReactElement | null {
  const call = useCall();
  if (call.phase === "idle") return null;
  return <VoiceScreen call={call} />;
}

function VoiceScreen({ call }: { readonly call: CallState }): React.ReactElement {
  const screen = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const caption = useCaption(call);
  // The home screen's moving waves, behind her (Settings → Effects turns both off).
  const backgroundOn = useHomeBackgroundEnabled();
  const inCall = call.phase !== "ended";
  // Esc leaves (ending the call); focus stays here and returns on close.
  useDialogFocus(screen, resetCall);

  const mood: OrbMood =
    call.muted && inCall && call.phase !== "connecting" ? "muted" : MOOD[call.phase];

  return (
    <div
      ref={screen}
      className="voice-mode"
      role="dialog"
      aria-modal="true"
      aria-label="Talking to Kleio"
      data-mood={mood}
      tabIndex={-1}
    >
      {backgroundOn && (
        <HomeDither
          className="voice-dither"
          waveColor={KLEIO_WAVES}
          backgroundColor={KLEIO_BACKGROUND}
        />
      )}
      <div className="voice-drag" data-tauri-drag-region />
      <button
        type="button"
        className="icon-circle voice-close"
        aria-label="Close"
        title="Close (Esc)"
        onClick={resetCall}
      >
        <XIcon size={18} weight="bold" aria-hidden="true" />
      </button>

      <div className="voice-stage">
        <OrbBoundary>
          <Suspense fallback={<div className="voice-orb-fallback" />}>
            <VoiceOrb
              className="voice-orb"
              mood={mood}
              levels={callLevels}
              reducedMotion={reducedMotion}
            />
          </Suspense>
        </OrbBoundary>
      </div>

      <div className="voice-words">
        <p className="voice-status" aria-live="polite">
          {STATUS[mood]}
        </p>
        {call.error ? (
          <p className="voice-error" role="alert">
            {call.error}
          </p>
        ) : (
          caption && <Captions caption={caption} />
        )}
      </div>

      <div className="voice-controls">
        {inCall ? (
          <>
            <button
              type="button"
              className="voice-button"
              aria-pressed={call.muted}
              onClick={() => setMuted(!call.muted)}
            >
              <span className="voice-button-icon" aria-hidden="true">
                {call.muted ? (
                  <MicrophoneIcon size={22} weight="bold" />
                ) : (
                  <MicrophoneSlashIcon size={22} weight="bold" />
                )}
              </span>
              <span className="voice-button-label">{call.muted ? "Unmute" : "Mute"}</span>
            </button>
            <button
              type="button"
              className="voice-button is-hangup"
              onClick={() => endCall()}
              data-modal-initial-focus
            >
              <span className="voice-button-icon" aria-hidden="true">
                <PhoneDisconnectIcon size={22} weight="fill" />
              </span>
              <span className="voice-button-label">Hang up</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="voice-button is-again"
            onClick={() => void startCall()}
            data-modal-initial-focus
          >
            <span className="voice-button-icon" aria-hidden="true">
              <MicrophoneIcon size={22} weight="bold" />
            </span>
            <span className="voice-button-label">Talk again</span>
          </button>
        )}
      </div>
    </div>
  );
}
