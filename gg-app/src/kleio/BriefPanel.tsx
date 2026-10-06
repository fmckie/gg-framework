// "Brief me": Kleio says what needs you, what finished and what is still
// working, out loud, with the words on screen as captions. Read-only.
//
// One small panel, mounted once inside the connected app (main.tsx), opened
// from the home screen's button, the menu bar's "Brief me" or ⌘⇧B.

import { useEffect, useSyncExternalStore } from "react";
import { ArrowClockwiseIcon, SpeakerHighIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { getBrief, KleioApiError, type Brief } from "./kleioApi";
import { canSpeak, primeSpeech, speak, stopSpeaking, useSpeaking } from "./kleioVoice";

type View =
  | { readonly kind: "closed" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly brief: Brief }
  | { readonly kind: "error"; readonly message: string };

const CLOSED: View = { kind: "closed" };
let view: View = CLOSED;
/** Bumped per request: a slow answer must not replace a newer one, or reopen a closed panel. */
let seq = 0;
const listeners = new Set<() => void>();

function setView(next: View): void {
  view = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** What went wrong, in words for the panel. */
export function briefError(e: unknown): string {
  if (e instanceof KleioApiError) {
    if (e.status === 0) return "I couldn't reach your Mac mini. Check it's on and connected.";
    if (e.status === 404) return "Your Mac mini needs the latest Kleio to give briefings.";
    if (e.status === 401 || e.status === 403)
      return "This device isn't connected to your Mac mini any more.";
  }
  return "Something went wrong getting your briefing. Try again in a moment.";
}

/**
 * Get the briefing and read it out. Call it straight from a tap, click or
 * menu: it unlocks speech before the network call.
 */
export async function briefMe(opts: { readonly all?: boolean } = {}): Promise<void> {
  primeSpeech();
  const mine = ++seq;
  setView({ kind: "loading" });
  let brief: Brief;
  try {
    brief = await getBrief(opts.all ?? false);
  } catch (e) {
    if (mine === seq) setView({ kind: "error", message: briefError(e) });
    return;
  }
  if (mine !== seq) return;
  setView({ kind: "ready", brief });
  await speak(brief.spoken);
}

/** Close the panel and stop talking. */
export function closeBrief(): void {
  seq++;
  stopSpeaking();
  setView(CLOSED);
}

export function BriefPanel(): React.ReactElement | null {
  const v = useSyncExternalStore(subscribe, () => view);
  const speaking = useSpeaking();
  const open = v.kind !== "closed";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeBrief();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (v.kind === "closed") return null;
  const title =
    v.kind === "loading"
      ? "Checking…"
      : v.kind === "error"
        ? "Briefing"
        : speaking
          ? "Kleio is speaking"
          : "Your briefing";

  return (
    <section className="brief-panel" aria-label="Kleio's briefing">
      <header className="brief-head">
        <span className={`brief-orb${speaking ? " is-speaking" : ""}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <h2 className="brief-title">{title}</h2>
        <button
          type="button"
          className="icon-circle brief-close"
          aria-label="Close briefing"
          title="Close (Esc)"
          onClick={closeBrief}
        >
          <XIcon size={16} weight="bold" aria-hidden="true" />
        </button>
      </header>
      {v.kind === "loading" && <p className="brief-text is-muted">Asking your Mac mini…</p>}
      {v.kind === "error" && (
        <p className="brief-text is-error" role="alert">
          {v.message}
        </p>
      )}
      {v.kind === "ready" && <p className="brief-text">{v.brief.spoken}</p>}
      {v.kind !== "loading" && (
        <div className="brief-actions">
          {v.kind === "ready" &&
            canSpeak() &&
            (speaking ? (
              <button type="button" className="btn btn-ghost brief-action" onClick={stopSpeaking}>
                <StopIcon size={16} weight="fill" aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost brief-action"
                onClick={() => {
                  primeSpeech();
                  void speak(v.brief.spoken);
                }}
              >
                <SpeakerHighIcon size={16} weight="bold" aria-hidden="true" />
                Say it again
              </button>
            ))}
          <button
            type="button"
            className="btn btn-ghost brief-action"
            onClick={() => void briefMe({ all: v.kind === "ready" })}
          >
            <ArrowClockwiseIcon size={16} weight="bold" aria-hidden="true" />
            {v.kind === "ready" ? "Last 24 hours" : "Try again"}
          </button>
        </div>
      )}
    </section>
  );
}
