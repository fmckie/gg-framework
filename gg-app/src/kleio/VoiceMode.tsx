// "Talk to Kleio": the voice screen, inside the Kleio window (the whole screen
// on the iPhone). Kleio as a living orb in the middle that swells with her
// voice and settles when she's quiet; who's talking and live subtitles under
// her; mute and hang up at the bottom. Everything she and you said scrolls
// into the main chat afterwards, so this screen shows only the moment.
//
// Opened from the home screen's button, the menu bar or ⌘⇧B once her voice is
// set up (Settings → Kleio's voice). Esc or the close button leaves; the call
// ends with it. What she shows (her `show` tool: a document, a picture, a PDF
// or a web page) opens in a panel beside her: the orb glides aside (to the
// left, or to the top on a phone) and the call keeps going. The "What Kleio
// Voice can do" guide opens over the call. Esc closes those first.

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
  QuestionIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useDialogFocus } from "../dialog-focus";
import { HomeDither } from "../HomeDither";
import { useHomeBackgroundEnabled } from "../home-background";
import { getVoiceStatus } from "./kleioApi";
import { KLEIO_BACKGROUND, KLEIO_WAVES } from "./kleioWaves";
import { briefMe } from "./BriefPanel";
import { boxWithin, flipTransform, pageZoom, type Box } from "./flip";
import { ShowPanel, showHeadline } from "./ShowPanel";
import {
  callLevels,
  closeShown,
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
import type { Shown } from "./voiceTools";

// three.js loads with the first conversation, not with the app.
const VoiceOrb = lazy(() => import("./VoiceOrb").then((m) => ({ default: m.VoiceOrb })));
// The guide loads when first opened, keeping the app's first load small.
const VoiceGuide = lazy(() => import("./VoiceGuide").then((m) => ({ default: m.VoiceGuide })));

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

// ── The glide when what she shows opens or closes ──────────────────────────

/** The panel's layout on a phone or a narrow window: it rises from below (as in kleio-theme.css). */
const STACKED = "(max-width: 759px)";
/** The orb's glide (FLIP: drawn where it was, then let go). */
const GLIDE: KeyframeAnimationOptions = { duration: 420, easing: "cubic-bezier(0.2, 0, 0, 1)" };
/** The panel leaving: its entrance (voice-show-in) in reverse. */
const LEAVE: KeyframeAnimationOptions = {
  duration: 320,
  easing: "cubic-bezier(0.4, 0, 1, 1)",
  fill: "forwards",
};

interface GlideRefs {
  readonly screen: React.RefObject<HTMLElement | null>;
  readonly stage: React.RefObject<HTMLElement | null>;
  readonly words: React.RefObject<HTMLElement | null>;
  readonly controls: React.RefObject<HTMLElement | null>;
  readonly panel: React.RefObject<HTMLElement | null>;
}

type GlideBoxes = { readonly [K in keyof GlideRefs]: Box | null };

interface GlideProps {
  /** Whether the panel is open: the layout the screen switches between. */
  readonly open: boolean;
  /** Reduced motion: the layout just switches. */
  readonly still: boolean;
  readonly refs: GlideRefs;
  /** The closed panel has finished leaving, so it can go. */
  readonly onLeft: () => void;
}

/**
 * Glides the orb, the words and the buttons between the two layouts, and
 * the closing panel out. It measures them just before React switches the
 * layout (getSnapshotBeforeUpdate, the one point a component can) and
 * again after, then draws them back where they were and lets them go.
 * Only transforms move, so the orb's canvas (sized by layout) resizes once,
 * not every frame. Draws nothing itself.
 */
class Glide extends Component<GlideProps> {
  /** What each element is doing, so a new glide starts from where it is. */
  private readonly moving = new Map<Element, Animation>();

  override getSnapshotBeforeUpdate(prev: GlideProps): GlideBoxes | null {
    if (prev.open === this.props.open) return null;
    const { refs } = this.props;
    const box = (r: React.RefObject<HTMLElement | null>): Box | null =>
      r.current?.getBoundingClientRect() ?? null;
    return {
      screen: box(refs.screen),
      stage: box(refs.stage),
      words: box(refs.words),
      controls: box(refs.controls),
      panel: box(refs.panel),
    };
  }

  override componentDidUpdate(_prev: GlideProps, _state: unknown, was: GlideBoxes | null): void {
    if (!was) return;
    const { refs, open, still, onLeft } = this.props;
    const zoom = pageZoom();
    const panel = refs.panel.current;
    if (!open && panel) this.leave(panel, was, zoom, onLeft);
    if (still) return;
    this.glide(refs.stage.current, was.stage, zoom, true);
    this.glide(refs.words.current, was.words, zoom, false);
    this.glide(refs.controls.current, was.controls, zoom, false);
  }

  override componentWillUnmount(): void {
    for (const a of this.moving.values()) a.cancel();
    this.moving.clear();
  }

  override render(): null {
    return null;
  }

  private start(el: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation {
    const a = el.animate(frames, options);
    this.moving.set(el, a);
    a.addEventListener("finish", () => {
      if (this.moving.get(el) === a) this.moving.delete(el);
    });
    return a;
  }

  /** `el`, laid out anew, drawn back at `first` and let go. */
  private glide(el: HTMLElement | null, first: Box | null, zoom: number, scale: boolean): void {
    if (!el || !first || typeof el.animate !== "function") return;
    // Where it was includes any glide still going; where it goes doesn't.
    this.moving.get(el)?.cancel();
    const move = flipTransform(first, el.getBoundingClientRect(), zoom, scale);
    if (!move) return;
    this.start(
      el,
      [
        { transform: move, transformOrigin: "0 0" },
        { transform: "none", transformOrigin: "0 0" },
      ],
      GLIDE,
    );
  }

  /**
   * The closed panel keeps the place it had (its CSS takes it out of the
   * layout while it leaves) and slides away as it fades; then it goes.
   */
  private leave(panel: HTMLElement, was: GlideBoxes, zoom: number, done: () => void): void {
    const at = was.panel;
    const frame = was.screen;
    const measured = at && frame && at.width > 0 && at.height > 0;
    if (this.props.still || !measured || typeof panel.animate !== "function") {
      done();
      return;
    }
    const box = boxWithin(at, frame, zoom);
    panel.style.left = `${box.left}px`;
    panel.style.top = `${box.top}px`;
    panel.style.width = `${box.width}px`;
    panel.style.height = `${box.height}px`;
    const stacked = typeof matchMedia === "function" && matchMedia(STACKED).matches;
    const away = stacked ? "translateY(24px)" : "translateX(24px)";
    const now = getComputedStyle(panel);
    this.moving.get(panel)?.cancel();
    this.start(
      panel,
      [
        { opacity: now.opacity, transform: now.transform === "none" ? "none" : now.transform },
        { opacity: 0, transform: away },
      ],
      LEAVE,
    ).addEventListener("finish", done);
  }
}

// ── The screen ─────────────────────────────────────────────────────────────

export function VoiceMode(): React.ReactElement | null {
  const call = useCall();
  // Going away mid-call ends it, so nobody is left on an invisible call that
  // holds the microphone and keeps the Mac awake.
  useEffect(() => () => resetCall(), []);
  if (call.phase === "idle") return null;
  return <VoiceScreen call={call} />;
}

/**
 * What's in the panel: what she's showing, else the one she closed while it
 * glides out (null under reduced motion: it just goes). Follows `shown` as it
 * changes, during render, so the leaving panel stays the same element.
 */
function usePanel(
  shown: Shown | null,
  still: boolean,
): { readonly panel: Shown | null; readonly left: () => void } {
  const [seen, setSeen] = useState(shown);
  const [leaving, setLeaving] = useState<Shown | null>(null);
  if (shown !== seen) {
    setSeen(shown);
    setLeaving(shown === null && !still ? seen : null);
  }
  const key = leaving?.key;
  return {
    panel: shown ?? leaving,
    left: () => setLeaving((l) => (l && l.key === key ? null : l)),
  };
}

/**
 * Focus goes back where it was when the panel closes or changes with focus
 * inside it (on its × say), to the last thing focused outside it. The panel
 * never takes focus itself: she may open it mid-sentence.
 */
function useFocusBack(
  screen: React.RefObject<HTMLElement | null>,
  shownKey: number | null,
): (e: React.FocusEvent) => void {
  const outside = useRef<HTMLElement | null>(null);
  const lastKey = useRef(shownKey);
  useLayoutEffect(() => {
    const was = lastKey.current;
    lastKey.current = shownKey;
    if (was === null || was === shownKey) return;
    const at = document.activeElement;
    const lost =
      !(at instanceof HTMLElement) || at === document.body || at.closest(".voice-show") !== null;
    if (!lost) return;
    const back = outside.current?.isConnected ? outside.current : null;
    (back ?? screen.current?.querySelector<HTMLElement>("[data-modal-initial-focus]"))?.focus();
  }, [screen, shownKey]);
  return (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && !t.closest(".voice-show")) outside.current = t;
  };
}

function VoiceScreen({ call }: { readonly call: CallState }): React.ReactElement {
  const screen = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const panelBox = useRef<HTMLElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const caption = useCaption(call);
  // The home screen's moving waves, behind her (Settings → Effects turns both off).
  const backgroundOn = useHomeBackgroundEnabled();
  const inCall = call.phase !== "ended";
  const [guide, setGuide] = useState(false);
  const open = call.shown !== null;
  const { panel, left } = usePanel(call.shown, reducedMotion);
  // Esc closes the guide (it handles its own Esc), else what she's showing,
  // else leaves, ending the call. Focus stays here and returns on close.
  useDialogFocus(screen, () => {
    if (guide) return;
    if (call.shown) closeShown();
    else resetCall();
  });
  const noteFocus = useFocusBack(screen, call.shown?.key ?? null);

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
      data-panel={open ? "open" : "closed"}
      tabIndex={-1}
      onFocus={noteFocus}
    >
      <Glide
        open={open}
        still={reducedMotion}
        refs={{ screen, stage, words, controls, panel: panelBox }}
        onLeft={left}
      />
      {backgroundOn && (
        <HomeDither
          className="voice-dither"
          waveColor={KLEIO_WAVES}
          backgroundColor={KLEIO_BACKGROUND}
        />
      )}
      <div className="voice-drag" data-tauri-drag-region />
      <div className="voice-corner">
        <button
          type="button"
          className="icon-circle"
          aria-label="What Kleio Voice can do"
          title="What Kleio Voice can do"
          onClick={() => setGuide(true)}
        >
          <QuestionIcon size={18} weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-circle"
          aria-label="Close"
          title="Close (Esc)"
          onClick={resetCall}
        >
          <XIcon size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <div ref={stage} className="voice-stage">
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

      <div ref={words} className="voice-words">
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

      <div ref={controls} className="voice-controls">
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
      {panel && (
        <ShowPanel
          key={panel.key}
          ref={panelBox}
          shown={panel}
          leaving={!open}
          onClose={closeShown}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {call.shown ? `Kleio is showing ${showHeadline(call.shown).title}` : ""}
      </p>
      {guide && (
        <Suspense fallback={null}>
          <VoiceGuide onClose={() => setGuide(false)} />
        </Suspense>
      )}
    </div>
  );
}
