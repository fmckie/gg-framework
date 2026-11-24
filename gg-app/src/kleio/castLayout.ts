// The Cast shelf's rules: how many shelves a number of specialists stands on,
// where each one stands, and what each is doing. Pure, so the layout is the
// same on every roster and testable without a page.

import { agentRowState } from "./AgentRow";
import { formatWhenShort, nextRun } from "./blobFormat";
import { lookOf, type BlobFaceKind, type BlobShape } from "./blobLook";
import type { Blob } from "./kleioApi";

/** One character large, one shelf, two shelves, or three and more. */
export type CastTier = "solo" | "one" | "two" | "crowd";

export interface CastLayout {
  tier: CastTier;
  /** How many stand on each shelf, back to front. */
  rows: number[];
  /** Places across the widest shelf. */
  cols: number;
  /** Specialists below the shelves that show without scrolling. */
  hidden: number;
}

/** Shelves that show at once; more than these and the shelves scroll. */
export const SHELVES_SHOWN = 3;

/** One shelf up to 9, two from 10 to 24, three from 25; past 36 they scroll. */
export function castLayout(count: number): CastLayout {
  if (count <= 0) return { tier: "one", rows: [], cols: 1, hidden: 0 };
  // Solo keeps a second place: where the next specialist will stand.
  if (count === 1) return { tier: "solo", rows: [1], cols: 2, hidden: 0 };
  if (count <= 9) return { tier: "one", rows: [count], cols: count, hidden: 0 };
  const shelves = count <= 24 ? 2 : Math.max(3, Math.ceil(count / 12));
  const per = Math.ceil(count / shelves);
  const rows: number[] = Array.from({ length: Math.floor(count / per) }, () => per);
  if (count % per) rows.push(count % per);
  return {
    tier: shelves === 2 ? "two" : "crowd",
    rows,
    cols: per,
    hidden: rows.slice(SHELVES_SHOWN).reduce((a, b) => a + b, 0),
  };
}

/** What a specialist is doing, as the shelf draws it. */
export type CastKind = "working" | "failed" | "paused" | "oncall" | "scheduled";

/** The same reading as its row's state (AgentRow.tsx), as a kind. */
export function castKind(blob: Blob): CastKind {
  if (blob.running) return "working";
  if (blob.lastRun?.endedAt && blob.lastRun.outcome === "error") return "failed";
  if (nextRun(blob.schedules)) return "scheduled";
  return blob.schedules.length > 0 ? "paused" : "oncall";
}

/** How far each body sits above the foot of its box, so feet meet the shelf (%). */
const FOOT: Record<BlobShape, number> = {
  orb: 8,
  mochi: 11,
  drop: 6,
  puff: 9,
  pill: 20,
  cube: 9,
  ghost: 8,
  star: 9,
};

export const castFoot = (shape: BlobShape): number => FOOT[shape];

/** The faces BlobAvatar draws with open eyes; the others have nothing to blink. */
const BLINKING: readonly BlobFaceKind[] = ["calm", "curious", "focused", "surprised", "cheeky"];

/** Blink clocks in each set (kleio-cast.css): lively on one shelf, calm on more. */
export const BLINK_CLOCKS = 8;
/** Seconds between one working character's bounce and the next one's. */
export const BOUNCE_STEP = 0.38;
/** More than this many and a next run is "Tue 07:30", not "Next tomorrow 07:30". */
export const FULL_LABELS_UP_TO = 7;

export interface CastActor {
  blob: Blob;
  kind: CastKind;
  /** Its state in full, as its row words it. */
  state: string;
  /** Under its name on the shelf: `state`, or a shorter next run on a full shelf. */
  label: string;
  foot: number;
  /** Idle with open eyes: its blink clock, "b1"–"b8" or "c1"–"c8". */
  clock?: string;
  /** Working: where its bounce starts, in seconds, so no two bounce together. */
  beat?: number;
  /** Its shelf, counted from the back. */
  row: number;
  /** Its place along the widest shelf; halves where a short shelf is centred. */
  col: number;
  /** On the front shelf, the one the profile's pointer can reach. */
  front: boolean;
}

export interface Cast {
  layout: CastLayout;
  actors: CastActor[];
}

/** Everyone on the shelves, in order, with where they stand and how they move. */
export function castOf(blobs: readonly Blob[], now: Date = new Date()): Cast {
  const layout = castLayout(blobs.length);
  const compact = blobs.length > FULL_LABELS_UP_TO;
  const clocks = layout.tier === "solo" || layout.tier === "one" ? "b" : "c";
  const actors: CastActor[] = [];
  // Working and blinking characters are counted apart, so beats and clocks go
  // round in order and neighbours never share one.
  let working = 0;
  let blinking = 0;
  let index = 0;
  layout.rows.forEach((size, row) => {
    const offset = layout.tier === "solo" ? 0 : (layout.cols - size) / 2;
    for (let place = 0; place < size; place++) {
      const blob = blobs[index++];
      if (!blob) continue;
      const kind = castKind(blob);
      const look = lookOf(blob);
      const state = agentRowState(blob, now).text;
      const next = kind === "scheduled" ? nextRun(blob.schedules) : null;
      const blinks = (kind === "scheduled" || kind === "oncall") && BLINKING.includes(look.face);
      actors.push({
        blob,
        kind,
        state,
        label: compact && next ? formatWhenShort(next, now) : state,
        foot: FOOT[look.shape],
        ...(blinks ? { clock: `${clocks}${(blinking++ % BLINK_CLOCKS) + 1}` } : {}),
        ...(kind === "working" ? { beat: -BOUNCE_STEP * working++ } : {}),
        row,
        col: place + offset,
        front: row === layout.rows.length - 1,
      });
    }
  });
  return { layout, actors };
}
