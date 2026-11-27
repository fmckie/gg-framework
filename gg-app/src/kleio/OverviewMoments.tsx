// Overview's three moments, each played once per device (overviewSeen.ts): the
// welcome on a new device's first open, one line the first time a needed step
// is seen done, and the finish when the last one is. No moment takes focus or
// adds anything to press. With reduced motion the words and timings are the
// same and nothing moves.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { localStorageOrNull } from "../app-entry-view";
import { KleioMark } from "./KleioMark";
import {
  markWelcomed,
  noteSteps,
  sightOf,
  STEP_IDS,
  welcomeOwed,
  type Sights,
  type StepId,
} from "./overviewSeen";

/** How long the welcome stays before the list replaces it. */
export const WELCOME_MS = 1_500;
/** How long the welcome waits to learn the host's name before going without it. */
export const NAME_WAIT_MS = 1_500;
/** How long one step's line stays, and how much longer for each line after the first. */
export const LINE_MS = 4_000;
export const LINE_MORE_MS = 2_000;
/** The line's fade, which kleio-settings.css matches. */
export const LINE_FADE_MS = 600;

export const WELCOME_HEADLINE = "Hi, I'm Kleio.";
export const FINISH_HEADLINE = "Kleio's ready.";

export function welcomeLine(hostName: string | null): string {
  return hostName
    ? `I'll live on ${hostName} and take the busywork off your hands.`
    : "I'll take the busywork off your hands.";
}

export function stepLine(step: StepId, hostName: string | null): string {
  if (step === "host") return hostName ? `Kleio is home on ${hostName}.` : "Kleio is home.";
  return {
    models: "Kleio can think with you now.",
    voice: "Kleio can hear you now.",
    apps: "Kleio can work in your apps now.",
  }[step];
}

export function finishLine(extrasLeft: boolean): string {
  return extrasLeft ? "Ask me anything. The extras below can wait." : "Ask me anything.";
}

function motionWelcome(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: no-preference)").matches
  );
}

export interface OverviewMoments {
  /** "waiting": blank, until the host's name is known; "showing": the welcome is up. */
  welcome: "waiting" | "showing" | null;
  welcomeLine: string;
  /** The list has just replaced the welcome, and motion is welcome. */
  arriving: boolean;
  /** The steps whose lines are showing, in setup order. */
  said: readonly StepId[];
  /** The lines are fading out. */
  leaving: boolean;
  /** Steps seen done on this visit, to fill their dots; empty with reduced motion. */
  fresh: readonly StepId[];
  /** The finish began on this visit. */
  finish: boolean;
  /** The finish's headline is being said to a screen reader. */
  finishSaid: boolean;
}

/**
 * `marks` are the four needed rows' marks; `settled` is a complete read;
 * `fault` is something leading the headline; `hostName` is null when the host
 * can't be named, and `hostKnown` says whether that is final.
 */
export function useOverviewMoments({
  marks,
  settled,
  fault,
  hostName,
  hostKnown,
}: {
  marks: Record<StepId, string>;
  settled: boolean;
  fault: boolean;
  hostName: string | null;
  hostKnown: boolean;
}): OverviewMoments {
  // Read before Overview marks itself seen (its own effect, after this render).
  const [newDevice] = useState(() => welcomeOwed(localStorageOrNull()));

  // ── the welcome ────────────────────────────────────────────────────────────
  // Spent as the visit begins, shown or cut short; a device that had already
  // seen Setup is marked without a word.
  useEffect(() => markWelcomed(localStorageOrNull()), []);
  const [gaveUp, setGaveUp] = useState(false);
  const [over, setOver] = useState(!newDevice);
  const [arriving, setArriving] = useState(false);
  const begun = newDevice && (hostKnown || gaveUp);
  // Its words are fixed as it begins.
  const [words, setWords] = useState<string | null>(null);
  if (begun && words === null) setWords(welcomeLine(hostName));
  useEffect(() => {
    if (!newDevice || begun) return;
    const t = window.setTimeout(() => setGaveUp(true), NAME_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [newDevice, begun]);
  useEffect(() => {
    if (!begun) return;
    const t = window.setTimeout(() => {
      setArriving(motionWelcome());
      setOver(true);
    }, WELCOME_MS);
    return () => window.clearTimeout(t);
  }, [begun]);

  // ── a step done, and the finish ────────────────────────────────────────────
  const [said, setSaid] = useState<readonly StepId[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [fresh, setFresh] = useState<readonly StepId[]>([]);
  const [finish, setFinish] = useState(false);
  const [finishSaid, setFinishSaid] = useState(false);

  const sights = Object.fromEntries(
    STEP_IDS.map((step) => [step, sightOf(step, marks[step], newDevice)]),
  ) as Sights;
  // Only a complete read is recorded, and only when what it shows has changed.
  const seen = settled ? `${STEP_IDS.map((s) => sights[s] ?? "-").join(" ")} ${fault}` : null;
  const latest = useRef({ sights, fault });
  useLayoutEffect(() => {
    latest.current = { sights, fault };
  });
  // Before paint, so the line and its room arrive with the read that earned them.
  useLayoutEffect(() => {
    if (seen === null) return;
    const now = noteSteps(localStorageOrNull(), latest.current.sights, latest.current.fault);
    if (now.said.length > 0) {
      setSaid((was) => [...was, ...now.said.filter((s) => !was.includes(s))]);
      setLeaving(false);
      if (motionWelcome()) setFresh((was) => [...was, ...now.said.filter((s) => !was.includes(s))]);
    }
    if (now.finish) {
      setFinish(true);
      setFinishSaid(true);
    }
  }, [seen]);

  // The lines stay a while, fade, and leave the region empty.
  const showing = said.length > 0 || finishSaid;
  const count = said.length;
  useEffect(() => {
    if (!showing) return;
    let fade: number | undefined;
    const clear = (): void => {
      setSaid([]);
      setFinishSaid(false);
      setLeaving(false);
    };
    const stay = window.setTimeout(
      () => {
        if (!motionWelcome()) return clear();
        setLeaving(true);
        fade = window.setTimeout(clear, LINE_FADE_MS);
      },
      LINE_MS + LINE_MORE_MS * Math.max(0, count - 1),
    );
    return () => {
      window.clearTimeout(stay);
      window.clearTimeout(fade);
    };
  }, [showing, count]);

  return {
    welcome: over ? null : begun ? "showing" : "waiting",
    welcomeLine: words ?? "",
    arriving,
    said,
    leaving,
    fresh,
    finish,
    finishSaid,
  };
}

/** The welcome: the mark, a greeting and one line. Nothing to press. */
export function OverviewWelcome({ line }: { line: string }): React.ReactElement {
  return (
    <div className="ov-page ov-welcome" role="status">
      <KleioMark small />
      <h2 className="ov-headline">{WELCOME_HEADLINE}</h2>
      <p className="ov-sub">{line}</p>
    </div>
  );
}

/**
 * Where a step's line is said: a status region that is in the page, empty,
 * before any words land in it. Once it has held a line it keeps that room
 * until Overview is left, so nothing jumps back when the line goes.
 */
export function OverviewStepLine({
  lines,
  leaving,
  finishSaid,
}: {
  lines: readonly string[];
  leaving: boolean;
  /** Also say the finish's headline, which is a heading and so isn't live. */
  finishSaid: boolean;
}): React.ReactElement {
  const region = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    if (lines.length > 0 && region.current) setRoom(region.current.offsetHeight);
  }, [lines]);
  const held = lines.length > 0 || room > 0;
  return (
    <div
      ref={region}
      className={`ov-said${held ? " has-room" : ""}${leaving ? " is-leaving" : ""}`}
      style={lines.length === 0 && room > 0 ? { minHeight: room } : undefined}
      role="status"
    >
      {finishSaid && <span className="sr-only">{FINISH_HEADLINE}</span>}
      {lines.map((line) => (
        <p key={line} className="ov-said-line">
          {line}
        </p>
      ))}
    </div>
  );
}
