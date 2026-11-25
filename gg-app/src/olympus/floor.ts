// The lane's engine, parts 2 to 7 of Olympus: the mockup's floor.js, with its
// card, its keyboard, its travel, the gods' tesserae, the floor's mosaic, the
// gods' fidgets, their notices and the crown, and the startle.
// Kleio's subagents as gods on one open lane, reconciled to the records by
// sync(agents). Nothing is choreographed: every step follows from the records
// and from where the others are.
// - The lane opens when the first agent is sent and shuts after the last god
//   has gone. It rises as it opens and falls as it shuts; a god sent while it
//   shuts waits for it to be down, and it rises again.
// - The floor: each opening sets the next of the three mosaics in turn,
//   temple, grove, agora, so no scene comes twice running. Its stones are set
//   as the lane rises, the lowest course first, and the first god lands as the
//   last courses go down. Before the lane falls they are prised up, the top
//   course first, and thrown off: never before the last is down. A narrower
//   lane shows the scene's middle. At rest the floor is drawn once, and again
//   only if the lane's width or the screen's density has changed.
// - Gods land one at a time. Each is set from its tesserae, from the feet up,
//   beside a place of its own where its greeting fits; the carved figure shows
//   through them, it says the greeting on a ribbon, and it walks to its place.
//   At its place a god faces the middle of the lane.
// - At its place a god acts its agent's latest tool in its own way. The tool's
//   family (look, web, make, run; think before the first tool, for a tool with
//   no family, and for a family the god has no pose for) picks the god's pose
//   from the cast data. heed() notes the pose a record asks for, and cue() puts
//   one cut on the clock for it, on the god's own beat. A pose shown is held
//   for its dwell; the latest want wins, so what came and went inside a dwell
//   is never shown; and three cuts in a few seconds double the dwell until a
//   pose has held. The one who flies rises as her pose cuts in, and comes down
//   before the next does. No record says a tool has ended, so a god holds a
//   tool's pose until the next begins.
// - Fidgets: a god holding a pose moves in its own way (fidget.ts, from the
//   cast data): a gesture with a start and an end, on the god's own beat,
//   counted from the cut that showed the pose. The whole figure may ease a
//   little; a limb only ever changes by a cut to another frame; a thing that
//   hangs free is the pose's own picture again, cut out, and moved. Only work
//   that is itself a rhythm comes round again. Nothing is put on the clock for
//   it: each frame is worked out from the time alone, so a fidget never delays
//   a cut, a cut ends it at once, and the run plays the same with fidgets off.
//   The one who flies rides on hers, and comes down for a cut from the height
//   she had, her wings still.
// - Notices: when a god arrives, finishes, fails or is stopped, the nearest
//   god at its work each side, within reach, may notice (notice(), from land()
//   and from the records: never a timer), by dice of its own and its nature:
//   a glance toward it, a turn to face it where its pose may turn, else a
//   glance back, for a few of its own beats. When a god finishes, the nearest
//   Nike at her work who is free raises the laurel wreath toward it instead:
//   her crown, shown in place of the pose her record asks for; she comes down
//   for it as for a cut, and rises after. A reaction is a record on the god
//   (react.ts), played from it and the time alone, as a fidget is: nothing is
//   put on the clock for it, it never delays a cut (a cut of the god's own
//   already coming goes first, and one landing ends it), it never draws the
//   floor's dice, and data-pose stays what the record asks for, so the run
//   plays the same with reactions off. Its fidget rests from the reaction's
//   start until the first bar after it, and an ending falls when it would
//   have with no reaction.
// - Startles: a click on a god at its work, or Enter or Space on it from the
//   keyboard, startles it (poke()): a cut to its start picture and a hop of
//   its nature's height, the whole figure easing back to the floor, held for
//   its beats, then a cut back to whatever its record asks for. It is a
//   record on the god in a slot of its own (react.ts), so the notices choose
//   as they did, and it is played from the record and the time alone: no
//   step is put on the clock for it, no cut is asked for or put off, the
//   floor's dice are never thrown, and data-pose stays what the record asks
//   for, so the run plays the same with startles off, or with nobody
//   pressing anything. A cut of the god's own, its leaving its work, a notice
//   or the crown armed for it, or a line put out near it ends it at once, and
//   one of those before it has begun drops it. It is no part of the
//   envelope: it is never begun where a line is near, so no line is ever
//   moved for one. Startled again within a few seconds it starts smaller: no
//   hop, two beats. The one who flies starts where she is, at her height,
//   with no hop. Its fidget rests from the start until the first bar after.
// - Places: every god has an envelope, all the floor it can cover at its
//   place, and two places are never nearer than their envelopes and a gap. A
//   first crowd is spread over the lane; a later god takes the gap with most
//   room, and if there isn't enough the nearest step aside: they walk to their
//   new places. A god with no room waits unseen until there is. Nobody walks
//   through anybody.
// - Ribbons: a line is held out only where all of it clears every other god
//   and every other ribbon: toward the middle of the lane, else the other way,
//   else a little higher. With nowhere yet the god waits for room, and if none
//   comes it goes on without a word. A ribbon unrolls from the hand, is held
//   whole, and is furled. Nobody walks, starts work or goes back to tesserae
//   into a ribbon: they wait until it is furled. And no line is held out into
//   the flight of a god's tesserae as it is set or as it goes.
// - Walking, a god glides and its pose swaps in steps, stride and stand, on
//   its own beat; it faces where it goes. Its pace, a dip or a lift, a stop to
//   look round, and how it sets off and pulls up are its move's, in the cast
//   data.
// - Done: a farewell, the seal pressed on its rolled scroll, and it walks off
//   and goes back to tesserae: they are prised up, the crown first, and thrown
//   off. Failed: it stands, dims and cracks, and crumbles where it stands.
//   Stopped: dimmed, with no crack, and its dimmed tesserae are lifted as a
//   done god's are: only a failure crumbles. An ending never waits for a
//   dwell; the one who flies comes down first.
// - From the sixth agent working at once, an agent waits unseen and lands,
//   oldest first, once a god has left its place.
// - The card: over the god the pointer is on, else the god focused from the
//   keyboard. While its god works it holds one height, over the highest the
//   god can reach there, a start included; walking, over its standing top;
//   otherwise over the pose shown. It is up over a god still being set,
//   follows its god as it
//   walks, and is down once its god begins to go, for all its tesserae's
//   flight. Its caret stays on its straight edge. It stays while the
//   pointer is on the god, its name or the card, and a moment after; Esc hides
//   it. The floor says whose card is up and where it stands; the words in it
//   are the caller's.
// - The keyboard: the gods are one toolbar, one tab stop, the arrows and Home
//   and End along the lane in floor order; the focused god's card shows, and
//   a cartouche frames its carved name. When the focused god goes, focus goes
//   to the nearest, and from the last to the composer. Enter or Space
//   startles the god with focus; one that is not at its work has nothing to
//   press, and says so.
// - Reduced motion: nothing travels. The lane opens and shuts at once, a god
//   is set at its place and steps aside by a cut, a ribbon shows whole, the
//   seal, the dimming and the crack are there or they aren't, and the dwell is
//   doubled: the lane as parts 2 to 4 had it. No dice are thrown for travel,
//   and no tessera is drawn: a god is there, and then it isn't. Nobody
//   fidgets: every pose is its first frame, untouched. A notice is only a turn
//   to face, and the crown a still, each a cut held twice as long; the one who
//   flies is simply down for her crown, and simply up after it. A start is
//   its picture as a still, with no hop, held twice its beats. Asked for in
//   the middle of a setting or an unsetting, that is cut too. The floor is
//   laid whole as the lane opens and gone as it shuts; asked for while its
//   stones are set or prised up, it is whole until the lane shuts.
// - The pool: a god waiting for a place hangs as a medallion, its row's cameo,
//   at the lane's end: on the side with fewer (the right on a tie), in the
//   first free slot from the top, so the oldest hangs highest. It is taken
//   down as its god is set, or as its record ends there, and the ones under
//   it move up a slot. It has a name and nothing to press, and says so. Under
//   reduced motion it is there or it isn't, and moves up by a cut. The piers,
//   its tesserae, its own startle and a failed one's crack are a later part.
// It runs on sim.ts's clock. Every step is put on it for its moment, and every
// throw of the dice falls in a step. A frame between steps is drawn from the
// state and the time alone, and nothing it draws is read back by a step, so a
// run plays the same however the frames fall. A tessera's flight is cut from
// dice of its god's own, and a floor stone's from its scene's: never the
// floor's; and an idling god's gestures are dealt by dice of its own, from its
// agent, its pose, the cut and the bar; and whether a god notices is thrown on
// dice of its own, from the two agents and the event. The clock sleeps unless
// something on the lane is changing: between two gestures, and before a
// reaction begins, it sleeps until the next, which the frame tells it of, with
// no step put on it. The card and the keyboard are no part of
// the run: they put nothing on that clock and never draw the floor's dice, so
// a run plays the same whoever looks at it. A press on a god leaves a mark on
// it and wakes the clock, no more: the frame that follows begins its start.

import type {
  Cast,
  CastGod,
  Crown,
  Fidget,
  Frames,
  Noticed,
  Pictures,
  Pose,
  Skill,
  StartOf,
  SvgNode,
} from "./cast";
import { POSES } from "./cast";
import {
  deal,
  fidgetAt,
  nextAt,
  shown as shownAs,
  STILL,
  type Dealt,
  type FidgetAt,
  type Shown,
} from "./fidget";
import { GODS, type GodId } from "./gods";
import {
  armed,
  begun,
  hushUntil,
  over,
  played,
  quarter,
  started,
  startOver,
  TURNED,
  type How,
  type Reaction,
  type Start,
} from "./react";
import {
  cropFloor,
  drawFloor,
  layScene,
  LIFT_END,
  MOSAIC,
  SCENES,
  SET_END,
  type FloorPhase,
  type LaidFloor,
  type SceneId,
} from "./mosaic";
import type { Sim, SimEvent, SimHost } from "./sim";
import {
  cutTesserae,
  dimmed,
  drawTesserae,
  UNSET,
  type Tessera,
  type TesseraeMode,
} from "./tesserae";
import type { ToolFamily } from "./tool-family";

/** How an agent's record reads, as its row has it (OlympusRows' rowState). */
export type LaneLook = "run" | "done" | "fail" | "stop";

/** One agent, as the lane needs it. */
export interface LaneAgent {
  readonly key: string;
  readonly god: GodId;
  readonly look: LaneLook;
  /** The family of its latest tool; think before its first. */
  readonly family: ToolFamily;
  /** How many tools it has started. */
  readonly tools: number;
}

export interface FloorOptions {
  readonly sim: Sim;
  readonly cast: Cast;
  /** The floor's dice: 0 to 1. */
  readonly random: () => number;
  /** Each god's pictures. */
  readonly poses: Readonly<Record<GodId, Pictures>>;
  /** The lane's width inside its frame; the element's own unless given. */
  readonly width?: () => number;
  /** A line's or a name's length as drawn; the element's own unless given. */
  readonly measure?: (el: HTMLElement) => number;
  /** Whether the reader asks for less motion; the window's setting unless given. */
  readonly reduced?: () => boolean;
  /** The card's frame, which the floor stands over a god. What it says is the caller's. */
  readonly card?: HTMLElement | null;
  /** Whose card is up now: an agent's key, or nobody's. */
  readonly onCard?: (key: string | null) => void;
  /** The id of an agent's row in the transcript: its god is described by it. */
  readonly describe?: (key: string) => string | undefined;
  /** Where focus goes when the last god leaves with it: the composer. */
  readonly away?: () => HTMLElement | null;
  /** The card's grace is a wait on the window's clock, never a step on the sim's. */
  readonly timer?: Pick<SimHost, "defer" | "cancel">;
  /** The scene an opening lays, asked once each time; in turn from the temple unless given. */
  readonly scene?: () => SceneId;
  /** Each god's second frames, by pose; a pose given none keeps its first. */
  readonly frames?: Readonly<Partial<Record<GodId, Frames>>>;
  /** Whether a god at its work fidgets: it does unless this is false, for tests and previews. */
  readonly fidget?: boolean;
  /** The crown's picture, for the god that gives one. */
  readonly crowns?: Readonly<Partial<Record<GodId, string>>>;
  /** Whether the gods notice each other: they do unless this is false, for tests and previews. */
  readonly react?: boolean;
  /** Each god's start picture; a god given none is never startled. */
  readonly starts?: Readonly<Partial<Record<GodId, string>>>;
  /** Whether a press startles a god at its work: it does unless this is false, for tests and previews. */
  readonly startle?: boolean;
  /** Whether a god waiting for a place shows as a medallion: it does unless this is false, for tests and previews. */
  readonly medallions?: boolean;
}

/** What the floor holds, for tests and previews. */
export interface FloorPeek {
  readonly open: boolean;
  /**
   * The lane as it stands now: shut, rising, open, its floor being prised up,
   * or falling; and its height under its rule.
   */
  readonly lane: {
    readonly mode: "shut" | "rise" | "open" | "lift" | "fall";
    readonly height: number;
  };
  /** The floor's mosaic, while one is laid: its scene, and whether it is being set, laid whole or prised up. */
  readonly floor: { readonly scene: SceneId; readonly phase: FloorPhase } | null;
  readonly width: number;
  /** Waiting to land, in order. */
  readonly queue: readonly string[];
  /** Waiting unseen for a place, oldest first. */
  readonly waiting: readonly string[];
  /** The medallions hung, in the order they were: whose, its side (-1 left) and slot, how far down it hangs and how far it shows now, and whether it is being taken down. */
  /** The piers: an anta's width now, whether they are wide, and the floor's edges. */
  readonly piers: { readonly width: number; readonly wide: boolean; readonly edges: Range };
  readonly medallions: readonly {
    readonly key: string;
    readonly side: -1 | 1;
    readonly slot: number;
    readonly y: number;
    readonly shown: number;
    readonly going: boolean;
  }[];
  readonly gods: readonly {
    readonly key: string;
    readonly god: GodId;
    /** Where it is now, walking or not. */
    readonly x: number;
    /** The floor its figure stands on now: from, to. */
    readonly figure: readonly [number, number];
    /** All the floor it can cover at its place, while it has one: from, to. */
    readonly place: readonly [number, number] | null;
    readonly face: number;
    /** The way it is turned now. */
    readonly dir: number;
    readonly pose: Pose;
    /** The pose its record asks for. */
    readonly want: Pose;
    /** How far off the floor it is held. */
    readonly lift: number;
    /** Its fidget, or a lean, while anything shows of it: what is written for it. */
    readonly fidget: Shown | null;
    /** Its reaction, while it shows one: how, and to whose record. */
    readonly react: { readonly how: How; readonly of: string } | null;
    /** Its start, while it shows one: whether it is the smaller start of a god startled again. */
    readonly start: { readonly small: boolean } | null;
    /** How far its figure shows, and its ribbon is unrolled, its seal pressed in, and it is dimmed: 0 to 1. */
    readonly shown: number;
    /** Its tesserae, while any are drawn: how they go, and whether in its dimmed ivories. */
    readonly tesserae: { readonly mode: TesseraeMode; readonly dim: boolean } | null;
    readonly unrolled: number | null;
    readonly press: number;
    readonly dim: number;
    readonly step: string;
    /** The line on its ribbon, and where the ribbon runs along the floor. */
    readonly line: string | null;
    readonly ribbon: readonly [number, number] | null;
    readonly ending: Exclude<LaneLook, "run"> | null;
  }[];
  /** The card: whose it is, its left and its foot in the lane, and its caret along it. */
  readonly card: {
    readonly key: string;
    readonly left: number;
    readonly foot: number;
    readonly caret: number;
  } | null;
}

export interface Floor {
  /** Reconcile the floor with the records. Cheap; called on every change. */
  sync(agents: readonly LaneAgent[]): void;
  /** The lane's frame may have changed width. */
  resize(): void;
  /** The carved names' face has loaded: measure them again. */
  remeasure(): void;
  peek(): FloorPeek;
  /** Back to an empty, shut lane, for good. */
  dispose(): void;
}

// ── The lane, CSS px ──
const LANE_H = 126;
const OPEN_H = LANE_H - 1; // the lane's height under its rule, open
const TREAD = 22;
const WIDE = 698; // the lane in the mockup's column; a narrow window's is less
const H = LANE_H - TREAD; // the floor above the stylobate
const HEAD = 33; // every pose's head line in its 73×100 cell
const AXIS = 2 * HEAD; // a god faces left by mirroring about its head: x → AXIS − x
const TOP = H - 100; // a cell's top, in the floor
const EDGE = 16; // inside the antae, with a little air
const GAP = 10; // between all one god can cover at its place and all the next can
const AIR = 90; // and the room a first crowd leaves between places besides: a line's length
const CAPACITY = 5; // the lane holds five working; from the sixth, they wait
const SHIFT_MIN = 14; // a god at its place doesn't step aside for less, if the lane works out without
const SQUEEZE = 12; // a newcomer between two gods may have this much less than the gaps
const TILT = 6; // degrees: a ribbon runs up and away from the hand
const RIB_HALF = 8.5; // half a ribbon's height
const RIB_PAD = 3; // kept clear all round a ribbon
const RIB_TOP = 3; // the lane's top, under the dock's rim
const LIFTS = [0, 3, 6]; // held a little higher, over a neighbour's low reach
const SPREAD = 16; // how far off a god's tesserae come in from as it is set
const SCATTER = 40; // and how far they fly as it goes back to them

// ── A god's turn, ms ──
const RISE = 420; // the lane opens
const FALL = 360; // and shuts
const LAND_AFTER = 1000; // the first god lands as the floor's last courses go down
const LAND_STILL = 500; // under reduced motion: a beat, so a crowd sent together is placed together
const LAND_GAP = 850; // and the next no sooner
const CLOSE_AFTER = 600; // the lane waits a beat after the last god has gone
const RETRY = 400; // no room yet to land: look again
const ASSEMBLE = 1150; // a god's tesserae are set, from the feet up
const REVEAL = 250; // then the carved figure shows through them
const UNSET_END = 1300; // it goes back to them: the figure gives way, and they are thrown off
const CRUMBLE_END = 1250; // or, failed, they fall and lie a moment
const NAME_OUT = 420; // its name goes as they begin to
const UNFURL = 650;
const SAY = 1400; // a line held out whole on the ribbon
const FURL = 280;
const SAID = SAY + 300; // under reduced motion, shown whole from first to last
const SEAL_AT = 300; // the seal comes down on the scroll
const PRESS = 180;
const SEALED = 1000; // it stands while the seal is pressed
const SEALED_STILL = SEALED + 200; // under reduced motion, with the seal on from the first
const GLANCE = 1050; // a stop on the way to look round
const FAIL_HOLD = 3000; // dimmed, and cracked if it failed, before it goes
const DIM_AT = 300; // it stands a moment; then it dims, and the crack comes
const DIM = 900;
const CRACK = 220;
const HOLD = 200; // waiting for room, for a line, a walk or the tesserae: look again
const GREET_WAIT = 1500; // a greeting waits this long for room, then the god goes on without a word
const BYE_WAIT = 3000; // a farewell waits its turn longer; then it seals its scroll and goes
const BYE_STUCK = 1200; // but if nothing round it will make room, the longest waiting goes after this

// ── A god at its work, ms ──
const DWELL = 900; // a pose shown is held this long at least, or two of the god's steps if that is longer
const STORM = { cuts: 3, within: 6000, calm: 3000 }; // so many cuts so close double the dwell, until a pose has held
const HOVER_UP = 240; // the one who flies: up, as her pose cuts in
const HOVER_DOWN = 180; // and down, before the next does

// ── The card ──
const TIP_W = 272;
const CARD_AIR = 10; // its foot over the highest its god reaches: its caret's tip clears that by 2px and more
const CELL_Y = LANE_H - 1 - TREAD - 100; // a cell's top in the lane, under its 1px groove
const CARET_IN = 16; // the caret's least distance from the card's ends: on its straight edge, clear of a corner
const HOVER_GRACE = 150; // ms it stays once the pointer has left the god and the card (WCAG 1.4.13)

// Greetings and farewells, in Kleio's voice: short, a little dry. Most are one
// god's own; two of each anyone may say.
type Line = readonly [text: string, who: GodId | "*"];
const LINES: Readonly<Record<"greeting" | "farewell", readonly Line[]>> = {
  greeting: [
    ["At your service.", "*"],
    ["Here, and listening.", "*"],
    ["I have the brief.", "athena"],
    ["Tell me everything.", "herodotus"],
    ["Already halfway there.", "hermes"],
    ["To the anvil, then.", "hephaestus"],
    ["All eyes on it.", "argus"],
    ["Let it be weighed.", "themis"],
    ["This one is ours.", "nike"],
  ],
  farewell: [
    ["It is written.", "*"],
    ["I leave it with you.", "*"],
    ["Sealed, and yours.", "athena"],
    ["There is more, another day.", "herodotus"],
    ["Done before you asked.", "hermes"],
    ["Built to last.", "hephaestus"],
    ["Nothing got past me.", "argus"],
    ["Weighed, and found true.", "themis"],
    ["Victory, as promised.", "nike"],
  ],
};

/** The floor's dice from a seed (the mockup's rng). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from a name (the mockup's hash): a pose's tesserae and a scene's stones are cut from dice of their own. */
const hash = (s: string): number =>
  [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

// The scene last laid, kept: a scene is laid the same every time.
let kept: LaidFloor | null = null;
function laidScene(id: SceneId): LaidFloor {
  if (kept?.id !== id)
    kept = layScene(
      MOSAIC.scenes.find((scene) => scene.id === id)!,
      rng(hash(id)),
    );
  return kept;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const smooth = (v: number): number => {
  const u = clamp01(v);
  return u * u * (3 - 2 * u);
};
const outCubic = (k: number): number => 1 - (1 - k) ** 3;
type Ease = (k: number) => number;
const EASE: Readonly<Record<CastGod["move"]["ease"], Ease>> = {
  linear: (k) => k,
  "ease-in-out": (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  "ease-out": outCubic,
};
/** A CSS cubic-bezier, as a function of time. */
function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number): number => ((ax * t + bx) * t + cx) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}
const riseEase = bezier(0.2, 0.75, 0.25, 1);
const fallEase = bezier(0.55, 0, 0.8, 0.3);

type Range = readonly [number, number];
interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** A line held out, or the room kept for one: where it runs along the floor. */
interface Rib {
  readonly text: string;
  readonly side: number;
  readonly lift: number;
  readonly ox: number;
  readonly oy: number;
  readonly reach: number;
  readonly x0: number;
  readonly x1: number;
}

type Ending = Exclude<LaneLook, "run">;
type Saying = "greet" | "report";

/** A step of a god's turn: what it is doing, from when to when. */
interface Seg {
  readonly kind:
    | "assemble"
    | "greet"
    | "report"
    | "seal"
    | "fail"
    | "work"
    | "hold"
    | "walk"
    | "glance"
    | "alight"
    | "unset";
  readonly t0: number;
  readonly t1: number;
  readonly then?: (t: number) => void;
  /** A wait for room for its tesserae to fly. */
  readonly why?: "unset";
  /** Going back to tesserae: lifted and thrown off, or fallen. */
  readonly how?: "lift" | "fall";
  /** A walk: from where to where, and how it sets off and pulls up. */
  readonly x0?: number;
  readonly x1?: number;
  readonly ease?: Ease;
  /** A walk, or a stop on one: to its place, or off the lane. */
  readonly purpose?: "seat" | "leave";
  /** A walk that ends in a stop to look round: where it goes on to after. */
  readonly glanceTo?: number | null;
  /** A stop to look round: where it goes on to. */
  readonly to?: number;
  /** Coming down: from how high; and, if she was crowning, whether turned about for it. */
  readonly h?: number;
  readonly crowned?: boolean | null;
  /** A walk cut short: where it had got to is where the god is. */
  halted?: boolean;
  timer?: SimEvent;
  /** A step that only wakes the clock, for a part of this one that begins late. */
  nudge?: SimEvent;
}

/** A god as a frame draws it: worked out from its step and the time alone. */
interface Vis {
  x: number;
  y: number;
  dir: number;
  pose: Pose;
  /** How far its figure and its name show, its ribbon is unrolled, and it is dimmed and cracked: 0 to 1. */
  fig: number;
  name: number;
  rib: number;
  dim: number;
  crack: number;
  sealed: boolean;
  /** The seal's size as it is pressed: 1 once it is on. */
  press: number;
  /** Its tesserae, while any are drawn: how they go, of which pose, how far in, and how far they show at rest. */
  tiles: {
    readonly mode: TesseraeMode;
    readonly pose: "speak" | "stand";
    readonly u: number;
    readonly a: number;
    readonly dim: boolean;
  } | null;
  /** Its fidget at its work, or a notice's lean or turn; STILL at rest, and anywhere else. */
  fid: Shown;
  /** The reaction it shows, if any, or its start. */
  react: How | "start" | "";
  /** Whether the next frame will draw it otherwise. */
  moving: boolean;
  /** If not, when its fidget will next move it of itself; never, if nothing is to come. */
  wake: number;
}

interface God {
  readonly key: string;
  readonly gid: GodId;
  readonly c: CastGod;
  /** Its agent's record, as last handed over. */
  agent: LaneAgent;
  readonly el: HTMLElement;
  readonly fig: HTMLElement;
  /** Its pictures' box: a fidget of the whole figure is a transform on it. */
  readonly posesEl: HTMLElement;
  /** The poses it has a second frame of, and each pose's cut-out part. */
  readonly seconds: ReadonlySet<Pose>;
  readonly parts: ReadonlyMap<Pose, HTMLElement>;
  /** The part being moved now. */
  moved: HTMLElement | null;
  /** The bars of idling dealt so far, in the pose it holds since its last cut. */
  readonly deals: { held: string; readonly bars: Map<number, Dealt | null> };
  /** Its latest reaction, a notice or the crown; her latest crown; and the latest that began, for the rest between notices. */
  react: Reaction | null;
  crowned: Reaction | null;
  noticed: Reaction | null;
  /** When its fidget rests for a reaction: in the pose cut in at `at`, from when until when. */
  hush: Hush[];
  /** Its latest start, when the reader pressed it; and when the one before that was over. */
  start: Start | null;
  startLast: number;
  readonly sealEl: SVGElement;
  readonly label: HTMLElement;
  labelW: number;
  ribbon: HTMLElement | null;
  rib: Rib | null;
  /** The greeting kept for it as it lands. */
  line: string | null;
  /** The line it last held out. */
  said: string | null;
  /** Since when it has waited for room. */
  waiting: number | null;
  x: number;
  dir: number;
  /** The way it faces at its place: toward the middle of the lane. */
  face: number;
  pose: Pose;
  /** The pose its record asks for; at its place, a cut to it is on the clock. */
  want: Skill;
  swap: SimEvent | null;
  /** The step that wakes the clock as the one who flies starts down for that cut. */
  nudge: SimEvent | null;
  /** When the pose shown was cut to, and when it took its place: its cuts fall on its steps from then. */
  shownAt: number;
  beat0: number;
  /** When the one who flies last began to rise. */
  upAt: number;
  /** Its latest cuts, and whether they have come so close that its dwell is doubled. */
  readonly cuts: number[];
  storm: boolean;
  /** The way Themis's scales last tipped. */
  lean: Skill | null;
  seat: number | null;
  landed: boolean;
  gone: boolean;
  ending: Ending | null;
  seg: Seg | null;
  sealed: boolean;
  /** How far it is dimmed and cracked, once that is settled: 0 or 1. */
  dim: number;
  crack: number;
  /** As the last frame drew it: what the card, the names and the keyboard go by. */
  vis: Vis | null;
  /** What was last written to the page, so a frame writes only what changed. */
  out: Record<string, unknown>;
}

interface Hush extends Rest {
  readonly r: Reaction;
  readonly at: number;
}

/** A while its fidget rests: from when until when. */
interface Rest {
  readonly from: number;
  readonly until: number;
}

/** A reaction that has begun. */
type Begun = Reaction & { start: number };

interface Placed {
  readonly g: God;
  readonly x: number;
}

const SVG = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Readonly<Record<string, string>>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
function grow(parent: SVGElement, nodes: readonly SvgNode[]): void {
  for (const node of nodes) {
    const el = svg(node.tag, node.attrs);
    if (node.children) grow(el, node.children);
    parent.append(el);
  }
}
function html(tag: string, className: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

/** A medallion: whose, the element, its side and slot, when it was hung, whether by a cut, when it was taken down and is gone, and its move up a slot. */
interface Medal {
  readonly god: God;
  readonly el: HTMLElement;
  readonly side: -1 | 1;
  slot: number;
  readonly t0: number;
  readonly cut: boolean;
  downAt: number | null;
  goneAt: number | null;
  slide: { from: number; t0: number } | null;
  drawn: string;
  /** How far down it hung as last drawn: its card stands over that. */
  y: number | null;
  /** Its latest rock on its peg; and when the one before that was over. */
  rock: Rock | null;
  rockLast: number;
  /** Whether it has something to press. */
  startable: boolean;
  /** Whether it shows the keyboard's focus. */
  focus: boolean;
}

/** A medallion's rock on its peg: when it begins, when something ended it, its beats and its tilt, degrees; off if it was ended before it began. */
interface Rock {
  readonly start: number;
  end: number;
  off: boolean;
  readonly beats: number;
  readonly tilt: number;
}

/** One in the toolbar, a god or a medallion: whose, its element, and where along the lane it is. */
interface BarItem {
  readonly god: God;
  readonly el: HTMLElement;
  readonly x: number;
}

export function createFloor(lane: HTMLElement, opts: FloorOptions): Floor {
  const { sim, cast: CAST, random } = opts;
  const godsEl = lane.querySelector<HTMLElement>(".oly-gods")!;
  const namesEl = lane.querySelector<HTMLElement>(".oly-names")!;
  const antae = [...lane.querySelectorAll<HTMLElement>(".oly-anta")]; // a lane may have none
  // The tesserae's canvas, behind the gods; a lane without one draws none.
  const fx = lane.querySelector<HTMLCanvasElement>("canvas.oly-fx");
  // The floor's, behind that; a lane without one has a bare bed.
  const bed = lane.querySelector<HTMLCanvasElement>("canvas.oly-mosaic");
  const measure = opts.measure ?? ((el: HTMLElement) => el.offsetWidth);
  const reduced =
    opts.reduced ??
    ((): boolean =>
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const card = opts.card ?? null;
  const fidgeting = opts.fidget !== false;
  const reacting = opts.react !== false;
  const N = CAST.notice;
  // The crown of the god that gives one, where the lane was handed its picture.
  const crownOf = (id: GodId): Crown | undefined =>
    reacting && opts.crowns?.[id] ? CAST.gods[id].rx.crown : undefined;
  const ST = CAST.startle;
  // A god's start, where the lane was handed its picture, and startles are not off.
  const startOf = (id: GodId): StartOf | undefined =>
    opts.startle !== false && opts.starts?.[id] ? CAST.gods[id].st : undefined;
  // The gods the reader has pressed since the last frame: the next begins their starts.
  const pressed = new Set<God>();
  // Startles are not off: a medallion rocks whole, so it needs no picture.
  const startling = opts.startle !== false;
  // The medallions the reader has pressed since the last frame: the next begins their rocks.
  const knocked = new Set<Medal>();
  const wall: Pick<SimHost, "defer" | "cancel"> = opts.timer ?? {
    defer: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => window.clearTimeout(handle as number),
  };
  const gods = new Map<string, God>(); // by agent key: landed, waiting to land, or waiting for a place
  const queue: God[] = []; // waiting to land, in the order they were sent
  const pool: God[] = []; // waiting unseen for a place, oldest first
  // The pool's medallions, in the order they were hung; and when each waiting god began to wait.
  const POOL = CAST.pool;
  const showPool = opts.medallions !== false;
  const medals: Medal[] = [];
  const pooledAt = new Map<God, number>();
  const laneTimers = new Set<SimEvent>();
  const recent: Record<"greeting" | "farewell", string[]> = { greeting: [], farewell: [] };
  const ended = new Map<string, number>(); // by agent key: the tools it had started when it last ended
  let latest: readonly LaneAgent[] = [];
  let landTimer: SimEvent | null = null;
  let nextLandAt = -Infinity;
  let disposed = false;

  // The lane: open while anyone is out. It rises as it opens and falls as it
  // shuts; its height on the way is each frame's.
  let mode: FloorPeek["lane"]["mode"] = "shut";
  let laneT0 = 0;
  let reopen = false; // asked for while it shuts: it rises again as soon as it is down
  let laneH = ""; // the height last written: none, so the stylesheet's
  let readyAt = 0;
  let closing: SimEvent | null = null;
  let W = WIDE;
  let edgeL = EDGE;
  let edgeR = W - EDGE;
  // The piers, this opening: asked for, widening since, wide; and the width last written.
  const piers = { want: false, t0: null as number | null, wide: false, w: "" };

  // The floor's mosaic: the scene laid on the lane, if one is; whether its
  // stones are going down or coming up, since when, and when the last is
  // down; the canvas's brush, asked for when the first floor is drawn; what
  // is on the canvas (nothing, a floor at rest by its scene, the lane's width
  // and the screen's density, or stones on their way); and the part of the
  // scene the lane shows, cut as its width changes.
  let turn = 0;
  const nextScene = opts.scene ?? ((): SceneId => SCENES[turn++ % SCENES.length]!);
  let scene: SceneId | null = null;
  let lifting = false;
  let floorT0 = 0;
  let laidAt = 0;
  let bedBrush: CanvasRenderingContext2D | null | undefined;
  let bedDrawn: string | null = "";
  let shownFloor: { key: string; floor: LaidFloor } | null = null;

  // The card and the keyboard: the god the pointer is over; the god whose card
  // the pointer holds up, which outlasts the pointer by a grace; whether the
  // pointer is on the card; the god with focus; whether the keyboard is in use
  // (from a key until the next press of a pointer); the god whose card Esc
  // hid; the god the lane's one tab stop is on; and the card as it stands.
  let overKey: string | null = null;
  let hoverKey: string | null = null;
  let onCard = false;
  let grace: unknown = null;
  let focusKey: string | null = null;
  let kbd = false;
  let dismissed: string | null = null;
  let rove: HTMLElement | null = null;
  let shown: FloorPeek["card"] = null;

  // The tesserae: the canvas's brush, asked for when the first are drawn;
  // whether the last frame drew any, so the canvas is wiped once they are
  // over; and each pose's stones and each god's ivories, cut as first needed.
  let brush: CanvasRenderingContext2D | null | undefined;
  let fxDrawn = false;
  const stones = new Map<string, Tessera[]>();
  const ivories = new Map<GodId, { lit: readonly string[]; dim: readonly string[] }>();

  // Every god's standing pictures, fetched once up front, so no god is set
  // before its own is in. A god's stride and its skill poses are fetched as it
  // is made, a greeting's length before the first can show.
  const preload = Object.values(opts.poses).flatMap((urls) =>
    (["speak", "stand"] as const).map((pose) => {
      const img = new Image();
      img.src = urls[pose];
      return img;
    }),
  );

  function later(t: number, fn: () => void): SimEvent {
    const e = sim.at(t, () => {
      laneTimers.delete(e);
      fn();
    });
    laneTimers.add(e);
    return e;
  }

  // Places. A god's place is where its cell stands; its envelope, in the cell,
  // is all it can cover there. At its place a god faces the middle of the lane,
  // and its envelope turns with it: facing left, it is mirrored about the head
  // line. So the room two neighbours need depends on how each faces.
  const mid = (): number => W / 2 - HEAD; // the place whose head line is the middle of the lane
  const facing = (x: number): number => (x + HEAD < W / 2 ? 1 : -1);
  const envOf = (god: God): Range =>
    god.face < 0 ? [AXIS - god.c.env[1], AXIS - god.c.env[0]] : god.c.env;
  const seatMin = (god: God): number => edgeL - envOf(god)[0];
  const seatMax = (god: God): number => edgeR - envOf(god)[1];
  const pitch = (a: God, b: God): number => envOf(a)[1] - envOf(b)[0] + GAP; // a to the left of b

  // ───────── the lane ─────────
  function measureLane(): boolean {
    const w = Math.round(opts.width ? opts.width() : lane.clientWidth);
    // A lane that isn't laid out (its chat hidden) keeps the width it had.
    if (w <= 0 || w === W) return false;
    W = w;
    edgeR = W - (piers.want ? POOL.edge : EDGE);
    return true;
  }

  // Gods may land while it is open, or still rising.
  const landable = (): boolean => mode === "rise" || mode === "open";

  function setHeight(h: number | null): void {
    const value = h === null ? "" : `${Math.round(h * 100) / 100}px`;
    if (value === laneH) return;
    laneH = value;
    lane.style.height = value;
  }

  function openLane(t: number): void {
    if (closing) {
      sim.cancel(closing);
      laneTimers.delete(closing);
      closing = null;
    }
    if (mode === "lift" || mode === "fall") {
      reopen = true;
      return;
    }
    if (mode !== "shut") return;
    lane.classList.remove("is-shut");
    measureLane();
    laneT0 = t;
    scene = nextScene();
    lifting = false;
    floorT0 = t;
    if (reduced()) {
      mode = "open";
      readyAt = t + LAND_STILL;
      laidAt = t;
      return;
    }
    readyAt = t + LAND_AFTER;
    laidAt = t + SET_END;
    mode = "rise";
    setHeight(0);
    later(t + RISE, () => {
      if (mode !== "rise") return;
      mode = "open";
      setHeight(null);
    });
  }

  function maybeClose(t: number): void {
    if (gods.size || queue.length || closing || !landable()) return;
    // A beat after the last god has gone, and not before the floor's last stone is down.
    closing = later(Math.max(t + CLOSE_AFTER, laidAt), () => {
      closing = null;
      if (gods.size || queue.length) return;
      const now = sim.now();
      if (reduced()) return shut(now);
      // The floor is prised up; then the lane falls.
      mode = "lift";
      lifting = true;
      floorT0 = now;
      later(now + LIFT_END, () => {
        const then = sim.now();
        if (reduced()) return shut(then);
        scene = null;
        mode = "fall";
        laneT0 = then;
        later(then + FALL, () => shut(sim.now()));
      });
    });
  }

  function shut(t: number): void {
    mode = "shut";
    scene = null;
    narrow();
    lane.classList.add("is-shut");
    setHeight(null);
    if (!reopen && !queue.length) return;
    reopen = false;
    openLane(t);
    scheduleLanding(t);
  }

  // The lane's height on its way up or down.
  function laneAt(now: number): number {
    if (mode === "shut") return 0;
    if (mode === "open" || mode === "lift") return OPEN_H;
    const k = clamp01((now - laneT0) / (mode === "rise" ? RISE : FALL));
    return OPEN_H * (mode === "rise" ? riseEase(k) : 1 - fallEase(k));
  }

  function renderLane(now: number): boolean {
    if (mode !== "rise" && mode !== "fall") return false;
    setHeight(laneAt(now));
    return true;
  }

  // ───────── the floor's mosaic ─────────
  // The floor at `now`: its scene, and how far into its setting or its
  // lifting the time is. Under reduced motion it is whole.
  function floorAt(now: number): { scene: SceneId; phase: FloorPhase; u: number } | null {
    if (!scene) return null;
    if (reduced() || (!lifting && now >= laidAt)) return { scene, phase: "shown", u: 0 };
    return { scene, phase: lifting ? "lift" : "set", u: now - floorT0 };
  }

  // The part of a scene the lane shows: its middle, a narrower lane less of it.
  function floorOn(id: SceneId, dx: number): LaidFloor {
    const key = `${id} ${W}`;
    if (shownFloor?.key !== key) shownFloor = { key, floor: cropFloor(laidScene(id), -dx, W - dx) };
    return shownFloor.floor;
  }

  // The floor's canvas blank, at the lane's width and the screen's density,
  // and the scene's middle on the lane's.
  function wipeBed(dpr: number, dx: number): CanvasRenderingContext2D | null {
    if (!bed) return null;
    if (bedBrush === undefined) bedBrush = bed.getContext("2d") ?? null;
    if (!bedBrush) return null;
    const w = Math.round(W * dpr);
    const h = Math.round(H * dpr);
    if (bed.width !== w) bed.width = w;
    if (bed.height !== h) bed.height = h;
    bedBrush.setTransform(dpr, 0, 0, dpr, dx * dpr, 0);
    bedBrush.clearRect(-dx, 0, W, H);
    return bedBrush;
  }

  // The floor as its frame has it. Its stones on their way are drawn every
  // frame; at rest it is drawn once, and not again until the lane's width or
  // the screen's density is another. Moving while a stone is on its way.
  const density = (): number => Math.max(1, window.devicePixelRatio || 1);
  function renderFloor(now: number): boolean {
    if (!bed) return false;
    const f = floorAt(now);
    const dpr = density();
    const still = !f ? "" : f.phase === "shown" ? `${f.scene} ${W} ${dpr}` : null;
    if (still !== null && still === bedDrawn) return false;
    const dx = Math.round((W - MOSAIC.w) / 2);
    const ctx = wipeBed(dpr, dx);
    bedDrawn = still;
    if (!ctx || !f) return false;
    drawFloor(ctx, floorOn(f.scene, dx), f.phase, f.u);
    return still === null;
  }

  // ───────── where gods may stand ─────────
  const working = (god: God): boolean => god.seg?.kind === "work";
  // At its place: at its work, or coming down from it.
  const seated = (god: God): boolean => working(god) || god.seg?.kind === "alight";
  // A walk is worked out from its step and the time: where it has got to at t.
  const walkX = (s: Seg, t: number): number =>
    lerp(s.x0!, s.x1!, s.ease!(clamp01((t - s.t0) / Math.max(1, s.t1 - s.t0))));
  const walking = (god: God): boolean => god.seg?.kind === "walk" && !god.seg.halted;
  const xAt = (god: God, t: number): number => (walking(god) ? walkX(god.seg!, t) : god.x);
  const dirAt = (god: God): number =>
    walking(god) ? Math.sign(god.seg!.x1! - god.seg!.x0!) || god.dir : god.dir;
  // A pose's figure along the floor, in the cell.
  const fpOf = (god: God, pose: Pose): Range => god.c.fp[pose] ?? god.c.fp.stand;

  function span(god: God, x: number, pose: Pose, dir: number): Range {
    const [a, b] = fpOf(god, pose);
    return dir > 0 ? [x + a, x + b] : [x + AXIS - b, x + AXIS - a];
  }

  // The floor a god covers at t: at its place, all it can cover there.
  function body(god: God, t: number): Range {
    const x = xAt(god, t);
    if (seated(god)) {
      const [a, b] = envOf(god);
      return [x + a, x + b];
    }
    return span(god, x, walking(god) ? "stride" : god.pose, dirAt(god));
  }

  // All a god can cover at a place, band by band: its envelope's outline there, as it faces.
  function reach(god: God, x: number): Box[] {
    const left = god.face < 0;
    return god.c.envol.map(([y, a, b]) => ({
      x0: x + (left ? AXIS - b : a),
      x1: x + (left ? AXIS - a : b),
      y0: TOP + y,
      y1: TOP + y + 2,
    }));
  }

  // ───────── ribbons: room for a line ─────────
  const COS = Math.cos((TILT * Math.PI) / 180);
  const TAN = Math.tan((TILT * Math.PI) / 180);
  const widths = new Map<string, number>();

  function ribbonEl(text: string, side: number): HTMLElement {
    const el = html("span", `oly-ribbon ${side > 0 ? "is-r" : "is-l"}`);
    const band = html("span", "oly-band");
    const initial = document.createElement("b");
    initial.textContent = text.slice(0, 1);
    band.append(initial, text.slice(1));
    el.append(band, html("span", "oly-roll")); // its rolled end, which the band unrolls behind
    return el;
  }

  // A line's length on the ribbon, in the reading serif: measured once.
  function ribbonW(text: string): number {
    let w = widths.get(text);
    if (w === undefined) {
      const el = ribbonEl(text, 1);
      el.style.visibility = "hidden";
      godsEl.append(el);
      w = measure(el);
      el.remove();
      widths.set(text, w);
    }
    return w;
  }

  // A line held out by a god standing at x: from the fingers, up and away at
  // the tilt, raised by lift. It runs along the floor from x0 to x1.
  function ribbonAt(god: God, x: number, side: number, lift: number, text: string): Rib {
    const [hx, hy] = god.c.hand;
    const ox = side > 0 ? x + hx - 2 : x + AXIS - hx + 2;
    const far = ribbonW(text) * COS + 1; // and the far end's corners, turned
    return {
      text,
      side,
      lift,
      ox,
      oy: TOP + hy - 2 - lift,
      reach: far,
      x0: side > 0 ? ox - 1 : ox - far,
      x1: side > 0 ? ox + far : ox + 1,
    };
  }

  // Its band's top and bottom where it passes over x.
  function bandAt(r: Rib, x: number): Range {
    const y = r.oy - clamp((x - r.ox) * r.side, 0, r.reach) * TAN;
    const h = RIB_HALF / COS;
    return [y - h, y + h];
  }

  // Whether a ribbon comes within RIB_PAD of a box, or within `pad`.
  function grazes(r: Rib, b: Box, pad = RIB_PAD): boolean {
    const lo = Math.max(r.x0, b.x0 - pad);
    const hi = Math.min(r.x1, b.x1 + pad);
    if (lo > hi) return false;
    const [t0, b0] = bandAt(r, lo);
    const [t1, b1] = bandAt(r, hi);
    return Math.min(t0, t1) < b.y1 + pad && Math.max(b0, b1) > b.y0 - pad;
  }

  // Whether two ribbons come within RIB_PAD of each other.
  function meet(r: Rib, q: Rib): boolean {
    const lo = Math.max(r.x0, q.x0) - RIB_PAD;
    const hi = Math.min(r.x1, q.x1) + RIB_PAD;
    for (let i = 0; i <= 8 && lo <= hi; i++) {
      const x = lerp(lo, hi, i / 8);
      const [a0, a1] = bandAt(r, x);
      const [c0, c1] = bandAt(q, x);
      if (a0 < c1 + RIB_PAD && c0 < a1 + RIB_PAD) return true;
    }
    return false;
  }

  // Whether a ribbon comes within RIB_PAD of a stretch of floor taken at full height.
  const across = (q: Rib, [lo, hi]: Range): boolean => q.x1 + RIB_PAD > lo && q.x0 - RIB_PAD < hi;
  const tall = ([x0, x1]: Range): Box => ({ x0, x1, y0: -Infinity, y1: Infinity });

  // A pose's figure along the floor from x, facing either way.
  function either(god: God, pose: Pose, x: number): Range {
    const [a, b] = fpOf(god, pose);
    return [x + Math.min(a, AXIS - b), x + Math.max(b, AXIS - a)];
  }

  // All the floor a god walking from a to b goes over, stride or stand, facing either way.
  function way(god: God, a: number, b: number): Range {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return [
      Math.min(either(god, "stride", lo)[0], either(god, "stand", lo)[0]),
      Math.max(either(god, "stride", hi)[1], either(god, "stand", hi)[1]),
    ];
  }

  const out = (g: God): boolean => g.landed && !g.gone;

  // Every line another god holds out now, or is kept for one landing.
  function ribbons(except: God): Rib[] {
    const held: Rib[] = [];
    for (const g of gods.values()) if (g !== except && out(g) && g.rib) held.push(g.rib);
    return held;
  }

  // What a god takes up while a line is held out near it. Standing, its
  // figure's floor at full height; walking, all the floor it has still to
  // cross; still to go to its place, the way there and all it can cover once it
  // is there; being set, or lifted, its tesserae's flight too, and so for one
  // walking off to be. At its place, the outline of its whole envelope: a line
  // clear of that stays clear whatever it does there.
  function zone(g: God, t: number): Box[] {
    const s = g.seg;
    const k = s?.kind;
    const x = xAt(g, t);
    const boxes: Box[] = [];
    const moving = walking(g) || k === "glance";
    if (moving) {
      const [a, b] = way(g, x, k === "glance" ? s!.to! : (s!.glanceTo ?? s!.x1!));
      const pad = s!.purpose === "leave" ? SCATTER : 0;
      boxes.push(tall([a - pad, b + pad]));
    } else if (
      k === "assemble" ||
      (k === "unset" && s!.how === "lift") ||
      (k === "hold" && s!.why === "unset")
    ) {
      const [a, b] = either(g, k === "assemble" ? "speak" : "stand", x);
      const pad = k === "assemble" ? SPREAD : SCATTER;
      boxes.push(tall([a - pad, b + pad]));
    } else if (seated(g)) boxes.push(...reach(g, x));
    else boxes.push(tall(either(g, g.pose, x)));
    if (g.seat != null && !g.ending) {
      const there = Math.abs(g.seat - x) <= 1.5;
      if (!there && !moving) boxes.push(tall(way(g, x, g.seat)));
      if (!there || !seated(g)) boxes.push(...reach(g, g.seat));
    }
    return boxes;
  }

  interface Near {
    readonly boxes: readonly Box[];
    readonly held: readonly Rib[];
  }

  // All a line held out by this god now must keep off.
  function around(god: God, t: number): Near {
    const boxes: Box[] = [];
    for (const g of gods.values()) if (g !== god && out(g)) boxes.push(...zone(g, t));
    return { boxes, held: ribbons(god) };
  }

  // Whether a god standing at x may hold this ribbon out: inside the lane,
  // clear of everything around it, and the god not standing up into another's.
  function clear(god: God, x: number, r: Rib, near: Near): boolean {
    if (r.x0 < edgeL || r.x1 > edgeR || bandAt(r, r.side > 0 ? r.x1 : r.x0)[0] < RIB_TOP)
      return false;
    const fig = span(god, x, "speak", r.side);
    if (near.held.some((q) => across(q, fig) || meet(r, q))) return false;
    return !near.boxes.some((b) => grazes(r, b));
  }

  // Where a god standing at x may hold this line out in full: toward the
  // middle of the lane first, then the other way, then a little higher.
  function placeRibbon(god: God, x: number, text: string, near: Near): Rib | null {
    const first = facing(x);
    for (const lift of LIFTS) {
      for (const side of [first, -first]) {
        const r = ribbonAt(god, x, side, lift, text);
        if (clear(god, x, r, near)) return r;
      }
    }
    return null;
  }

  // What every other god holds: where it is, where its walk ends, and the place
  // it is bound for; and, standing anywhere but at its work, the room its first
  // stride takes, whichever way it sets off.
  function claims(except: God, t: number): Range[] {
    const held: Range[] = [];
    for (const g of gods.values()) {
      if (g === except || !out(g)) continue;
      let [lo, hi] = body(g, t);
      if (walking(g)) {
        lo = Math.min(lo, g.seg!.x1! + 4);
        hi = Math.max(hi, g.seg!.x1! + 64);
      } else if (!seated(g)) {
        const [a, b] = either(g, "stride", g.x);
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
      }
      if (g.seat != null) {
        const [a, b] = envOf(g);
        lo = Math.min(lo, g.seat + a);
        hi = Math.max(hi, g.seat + b);
      }
      held.push([lo, hi]);
    }
    return held;
  }

  const byseat = (): (God & { seat: number })[] =>
    [...gods.values()]
      .filter((g): g is God & { seat: number } => g.seat != null && !g.gone)
      .sort((a, b) => a.seat - b.seat);

  // Spread a crowd over the lane, left to right in this order: each pair as far
  // apart as their envelopes need, with air between where there is room, a
  // little off the middle and not quite even.
  function evenSeats(order: readonly God[]): number[] {
    const n = order.length;
    const need = [0]; // each one's place from the first's, at the least
    for (let i = 1; i < n; i++) need.push(need[i - 1]! + pitch(order[i - 1]!, order[i]!));
    const lo = seatMin(order[0]!);
    const slack = Math.max(0, seatMax(order[n - 1]!) - need[n - 1]! - lo);
    const air = n > 1 ? Math.min(AIR, slack / (n - 1)) : 0;
    const start = lo + (slack - air * (n - 1)) * (0.25 + 0.5 * random());
    const jit = Math.min(7, air / 2);
    return order.map((g, i) =>
      clamp(
        start + need[i]! + i * air + (n > 1 ? (random() - 0.5) * 2 * jit : 0),
        seatMin(g),
        seatMax(g),
      ),
    );
  }

  // The least anyone has to move for everyone to have room: places in order,
  // each pair at least its pitch apart, the first and the last inside the lane.
  // Those in stay don't move at all; null if that leaves the ones between them
  // without room, even a little nearer than the gap.
  function spread(all: readonly Placed[], stay: ReadonlySet<God>): number[] | null {
    const seats = all.map((o) => o.x);
    for (let i = 0; i < all.length; i++) {
      if (stay.has(all[i]!.g)) continue;
      // all[i..j] may move, between whoever stays either side of them, or the lane's ends
      let j = i;
      while (j + 1 < all.length && !stay.has(all[j + 1]!.g)) j++;
      const need = [0];
      for (let k = i + 1; k <= j; k++)
        need.push(need[need.length - 1]! + pitch(all[k - 1]!.g, all[k]!.g));
      const lo = i ? seats[i - 1]! + pitch(all[i - 1]!.g, all[i]!.g) : seatMin(all[i]!.g);
      const hi =
        (j + 1 < all.length
          ? seats[j + 1]! - pitch(all[j]!.g, all[j + 1]!.g)
          : seatMax(all[j]!.g)) - need[j - i]!;
      if (hi < lo - SQUEEZE) return null;
      const blocks: { s: number; n: number }[] = [];
      for (let k = i; k <= j; k++) {
        blocks.push({ s: all[k]!.x - need[k - i]!, n: 1 });
        while (blocks.length > 1) {
          const b = blocks[blocks.length - 1]!;
          const a = blocks[blocks.length - 2]!;
          if (a.s / a.n <= b.s / b.n) break;
          a.s += b.s;
          a.n += b.n;
          blocks.pop();
        }
      }
      let k = i;
      for (const b of blocks)
        for (let m = 0; m < b.n; m++, k++)
          seats[k] = (hi < lo ? (lo + hi) / 2 : clamp(b.s / b.n, lo, hi)) + need[k - i]!;
      i = j;
    }
    return seats;
  }

  // A place for a god about to land. False if there is no room for it yet.
  function planSeat(god: God, t: number): boolean {
    if (god.seat != null) return true;
    const others = byseat();
    if (!others.length) {
      // A first crowd: everyone sent so far gets a place now, in a random order along the lane.
      const order = queue.filter((g) => g.seat == null);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      // The left half of them face right and the right half left; an odd one in the middle, either.
      order.forEach((g, i) => {
        const side = i - (order.length - 1) / 2;
        g.face = side < 0 ? 1 : side > 0 ? -1 : random() < 0.5 ? 1 : -1;
      });
      const seats = evenSeats(order);
      order.forEach((g, i) => (g.seat = seats[i]!));
      // One alone has no half to be in: it faces the middle from where it stands.
      if (order.length === 1) {
        const g = order[0]!;
        g.face = facing(g.seat!);
        g.seat = clamp(g.seat!, seatMin(g), seatMax(g));
      }
      return true;
    }
    const face = god.face;
    const best = gapFor(god, others);
    god.face = best.face; // kept while it has this place: stepping aside doesn't turn it
    const all: Placed[] = [...others.map((g) => ({ g, x: g.seat })), { g: god, x: best.x }].sort(
      (a, b) => a.x - b.x,
    );
    // Whoever would step aside only a little stays where it is, if the lane
    // works out without it: the one asked to move least first, and the rest
    // looked at again each time one stays.
    const stay = new Set<God>();
    let seats = spread(all, stay);
    if (!seats) {
      // Not without two places overlapping: it waits for one to be left.
      god.face = face;
      return false;
    }
    for (let held = true; held;) {
      held = false;
      const few = all
        .map((o, i) => ({ g: o.g, d: Math.abs(seats![i]! - o.x) }))
        .filter((o) => o.g !== god && !stay.has(o.g) && o.d <= SHIFT_MIN)
        .sort((a, b) => a.d - b.d);
      for (const { g } of few) {
        stay.add(g);
        const tried = spread(all, stay);
        if (tried) {
          seats = tried;
          held = true;
          break;
        }
        stay.delete(g);
      }
    }
    all.forEach((o, i) => {
      if (o.g === god) god.seat = seats![i]!;
      else if (Math.abs(seats![i]! - o.x) > 0.5) reseat(o.g, seats![i]!, t);
    });
    return true;
  }

  // A later one takes the gap with most room for it; if that is too narrow, the
  // nearest make room. It faces the middle from the gap it takes, and its
  // envelope turns with it, so each gap is measured as it would stand there.
  // It draws no dice. god.face is left as the last gap tried; the caller sets it.
  function gapFor(
    god: God,
    others: readonly (God & { seat: number })[],
  ): { x: number; room: number; face: number } {
    let best: { x: number; room: number; face: number } | null = null;
    const consider = (gap: () => { x: number; room: number }): void => {
      let o = { x: 0, room: 0 };
      for (const face of [1, -1]) {
        god.face = face;
        o = gap();
        if (facing(o.x) === face) break;
      }
      if (
        !best ||
        o.room > best.room + 4 ||
        (Math.abs(o.room - best.room) <= 4 && Math.abs(o.x - mid()) < Math.abs(best.x - mid()))
      )
        best = { ...o, face: god.face };
    };
    const first = others[0]!;
    const last = others[others.length - 1]!;
    consider(() => {
      const x = Math.max(seatMin(god), first.seat - pitch(god, first) - AIR);
      return { x, room: first.seat - pitch(god, first) - x };
    });
    consider(() => {
      const x = Math.min(seatMax(god), last.seat + pitch(last, god) + AIR);
      return { x, room: x - last.seat - pitch(last, god) };
    });
    for (let i = 0; i + 1 < others.length; i++) {
      consider(() => {
        const lo = others[i]!.seat + pitch(others[i]!, god);
        const hi = others[i + 1]!.seat - pitch(god, others[i + 1]!);
        return { x: (lo + hi) / 2, room: (hi - lo) / 2 };
      });
    }
    return best!;
  }

  interface Entry {
    readonly x: number;
    readonly text: string | null;
    readonly r: Rib | null;
  }

  // Where a god is set, and the greeting it will say there: beside its place,
  // on the middle side mostly, so a first crowd walks out both ways; where
  // nobody is and no ribbon is, with a line that can be held out in full. If
  // none fits yet, it is set anyway, and looks for room for a line once it is.
  // Under reduced motion it is set at its place.
  function entryFor(god: God, t: number): Entry | null {
    const taken = claims(god, t);
    const held = ribbons(god);
    const free = (x: number): boolean => {
      const [a, b] = either(god, "speak", x);
      return (
        x + 4 >= edgeL - 6 &&
        x + 64 <= edgeR + 6 &&
        taken.every(([lo, hi]) => b + 2 <= lo || a - 2 >= hi) &&
        !held.some((q) => across(q, [a - SPREAD, b + SPREAD]))
      );
    };
    const seat = god.seat!;
    let spots = [seat];
    if (!reduced()) {
      const side = (seat < mid() ? 1 : -1) * (random() < 0.8 ? 1 : -1);
      const far = 62 + random() * 34;
      spots = [seat + side * far, seat - side * far, seat + side * 44, seat - side * 44, seat];
    }
    spots = spots.filter(free);
    if (!spots.length) return null;
    const near = around(god, t);
    const where = new Map<Rib, number>();
    const said = pickLine("greeting", god, (text) => {
      for (const x of spots) {
        const r = placeRibbon(god, x, text, near);
        if (!r) continue;
        where.set(r, x);
        return r;
      }
      return null;
    });
    return said
      ? { x: where.get(said.r)!, text: said.text, r: said.r }
      : { x: spots[0]!, text: null, r: null };
  }

  // A line for a god to say, of those fit(text) finds room for: its own most
  // often, or one any god may, and never what the last three gods said.
  function pickLine(
    kind: "greeting" | "farewell",
    god: God,
    fit: (text: string) => Rib | null,
  ): { text: string; r: Rib } | null {
    const avoid = recent[kind];
    const found: { text: string; w: number; r: Rib }[] = [];
    let total = 0;
    for (const [text, who] of LINES[kind]) {
      const w = avoid.includes(text) ? 0 : who === god.gid ? 3 : who === "*" ? 1 : 0;
      const r = w > 0 ? fit(text) : null;
      if (!r) continue;
      found.push({ text, w, r });
      total += w;
    }
    if (!total) return null;
    let dice = random() * total;
    let chosen = found[found.length - 1]!;
    for (const o of found) {
      dice -= o.w;
      if (dice <= 0) {
        chosen = o;
        break;
      }
    }
    avoid.push(chosen.text);
    if (avoid.length > 3) avoid.shift();
    return { text: chosen.text, r: chosen.r };
  }

  // ───────── a god ─────────
  function makeGod(a: LaneAgent): God {
    const c = CAST.gods[a.god];
    const el = html("div", "oly-cell");
    el.dataset.god = a.god;
    // One of the lane's toolbar. It has nothing to press until it is at its work, and says so.
    el.setAttribute("role", "button");
    el.tabIndex = -1;
    el.setAttribute("aria-label", c.name);
    el.setAttribute("aria-disabled", "true");
    const row = opts.describe?.(a.key);
    if (row) el.setAttribute("aria-describedby", row); // its row in the transcript is the record
    el.style.setProperty("--oly-ex", `${c.seal[0]}px`);
    el.style.setProperty("--oly-ey", `${c.seal[1]}px`);
    const fig = html("div", "oly-fig");
    const poses = html("div", "oly-poses");
    const urls = opts.poses[a.god];
    const picture = (pose: Pose | "crown" | "start", url: string): HTMLImageElement => {
      const img = document.createElement("img");
      img.className = `oly-pose oly-p-${pose}`;
      img.src = url;
      img.alt = "";
      img.draggable = false;
      poses.append(img);
      return img;
    };
    for (const pose of POSES) picture(pose, urls[pose]);
    // A skill pose is as wide as it needs: its picture sits in the cell on its
    // own axis, the body where the standing body is.
    // A god that fidgets has, after a pose, its second frame, shown in its
    // place for a move that is a limb's; and its cut-out part, the pose's own
    // picture again clipped to the part (--oly-clip), which is moved while the
    // pose is shown with the part's hole cut out of it (--oly-hole).
    const seconds = new Set<Pose>();
    const parts = new Map<Pose, HTMLElement>();
    const px = (points: readonly Range[]): string =>
      points.map(([x, y]) => `${x}px ${y}px`).join(",");
    for (const [pose, at] of Object.entries(c.at) as [Skill, Range][]) {
      const url = urls[pose];
      if (!url) continue;
      const img = picture(pose, url);
      img.style.left = `${at[0]}px`;
      img.style.width = `${at[1]}px`;
      if (!fidgeting) continue;
      const second = c.frames[pose] && opts.frames?.[a.god]?.[pose];
      if (second) {
        const frame = picture(pose, second);
        frame.classList.add("oly-f-b");
        frame.style.left = img.style.left;
        frame.style.width = img.style.width;
        seconds.add(pose);
      }
      const cut = c.parts[pose];
      if (cut) {
        const [w, h] = [at[1], CAST.cell.h];
        img.style.setProperty(
          "--oly-hole",
          `polygon(evenodd,0px 0px,${w}px 0px,${w}px ${h}px,0px ${h}px,0px 0px,${px(cut.hole)},${px(cut.hole.slice(0, 1))})`,
        );
        const part = document.createElement("img");
        part.className = "oly-part";
        part.dataset.of = pose;
        part.src = url;
        part.alt = "";
        part.draggable = false;
        part.style.left = img.style.left;
        part.style.width = img.style.width;
        part.style.setProperty("--oly-clip", `polygon(${px(cut.cut)})`);
        poses.append(part);
        parts.set(pose, part);
      }
    }
    // The crown, for the god that gives one: shown in place of the pose its
    // record asks for while it is raised, and sat in the cell as a skill pose is.
    const crown = crownOf(a.god);
    if (crown) {
      const img = picture("crown", opts.crowns![a.god]!);
      img.style.left = `${crown.at[0]}px`;
      img.style.width = `${crown.at[1]}px`;
    }
    // Its start, for a god that can be startled: shown in place of the pose
    // its record asks for while it starts, and sat in the cell as a skill pose is.
    const st = startOf(a.god);
    if (st) {
      const img = picture("start", opts.starts![a.god]!);
      img.style.left = `${st.at[0]}px`;
      img.style.width = `${st.at[1]}px`;
    }
    const seal = svg("svg", { class: "oly-seal", viewBox: CAST.seal.viewBox });
    grow(seal, CAST.seal.nodes);
    const fissure = svg("svg", {
      class: "oly-fissure",
      viewBox: `0 0 ${CAST.cell.w} ${CAST.cell.h}`,
    });
    grow(fissure, c.fissure);
    fig.append(poses, seal, fissure);
    el.append(fig);
    const label = html("p", "oly-ins");
    label.textContent = c.name; // the god's own name; the agent's is in its row and its card
    const key = a.key;
    for (const node of [el, label]) {
      node.addEventListener("pointerenter", () => {
        overKey = hoverKey = key;
        stay();
        attend();
      });
      node.addEventListener("pointerleave", () => {
        if (overKey === key) overKey = null;
        if (dismissed !== key) return linger();
        // Esc hid its card: it stays hidden as the pointer goes, with no grace to flash it back.
        if (hoverKey === key) hoverKey = null;
        if (focusKey !== key) dismissed = null;
        attend();
      });
      // A press never takes the caret out of the text box.
      node.addEventListener("mousedown", (e) => e.preventDefault());
    }
    const god: God = {
      key: a.key,
      gid: a.god,
      c,
      agent: a,
      el,
      fig,
      posesEl: poses,
      seconds,
      parts,
      moved: null,
      deals: { held: "", bars: new Map() },
      react: null,
      crowned: null,
      noticed: null,
      hush: [],
      start: null,
      startLast: -Infinity,
      sealEl: seal,
      label,
      labelW: 0,
      ribbon: null,
      rib: null,
      line: null,
      said: null,
      waiting: null,
      x: 0,
      dir: 1,
      face: 1,
      pose: "speak",
      want: c.acts.think.pose,
      swap: null,
      nudge: null,
      shownAt: 0,
      beat0: 0,
      upAt: 0,
      cuts: [],
      storm: false,
      lean: null,
      seat: null,
      landed: false,
      gone: false,
      ending: null,
      seg: null,
      sealed: false,
      dim: 0,
      crack: 0,
      vis: null,
      // At rest, as built: nothing to write until it fidgets, or can be startled.
      out: { fid: "", frame: "", part: "", react: "", startable: false },
    };
    god.want = poseFor(god);
    // A click on the god startles it; its carved name only holds its card up.
    el.addEventListener("click", () => press(god));
    return god;
  }

  // ───────── skills: the tool decides what, the god how ─────────
  // The pose a god acts its record in: its latest tool's family, in the god's
  // own way. A family the god has no pose for is thinking, and so is an agent
  // with no tool yet. An agent sent on again still names its last turn's last
  // tool: it thinks until it starts another.
  function poseFor(god: God): Skill {
    const { family, tools } = god.agent;
    const acts = god.c.acts;
    const act = (ended.get(god.key) !== tools && acts[family]) || acts.think;
    const scales = act.verdict;
    if (!scales) return act.pose;
    // Themis's scales. Nothing says how a finding went, so she tips them the
    // other way each time she comes back to them; at them, or on her way back
    // to them, they stay as they are.
    for (const pose of [god.pose, god.want])
      if (pose === scales.confirmed || pose === scales.dropped) return pose;
    return god.lean === scales.confirmed ? scales.dropped : scales.confirmed;
  }

  // A storm is over once a pose has held long enough.
  function calm(god: God, t: number): void {
    if (!god.storm || t - god.shownAt < STORM.calm) return;
    god.storm = false;
    god.cuts.length = 0;
  }

  // How long the pose shown must be held: its dwell, doubled in a storm and under reduced motion.
  function dwell(god: God, t: number): number {
    calm(god, t);
    return Math.max(DWELL, 2 * god.c.step) * (god.storm ? 2 : 1) * (reduced() ? 2 : 1);
  }

  // The record has changed: note the pose it asks for now. If that is what the
  // god already wants there is nothing to do (a read, then a grep; Nike's look
  // and her web are one pose). A god not yet at its place keeps the note, and
  // starts work in what it wants when it gets there.
  function heed(god: God, t: number): void {
    const pose = poseFor(god);
    if (pose === god.want) return;
    god.want = pose;
    if (!working(god)) return;
    cue(god, t);
    settle(god, t);
  }

  // How far off the floor a pose is held at its work: the one who flies, at her look.
  const liftOf = (god: God): number =>
    (god.c.lift as Readonly<Partial<Record<Pose, number>>>)[god.pose] ?? 0;

  function uncue(god: God): void {
    sim.cancel(god.swap);
    sim.cancel(god.nudge);
    god.swap = null;
    god.nudge = null;
  }

  // One cut on the clock for a god at work in a pose it no longer wants: at the
  // first of its own beats once the pose shown has had its dwell, and the one
  // who flies has had time to come down. Asked again, it is replaced: the
  // latest want wins, and what came and went in between is never shown.
  function cue(god: God, t: number): void {
    const down = liftOf(god) && !reduced() ? HOVER_DOWN : 0;
    // Already coming down for a cut: it falls when it was set to, and takes what is wanted then.
    if (god.swap && down && t >= god.swap.t - down) return;
    uncue(god);
    if (god.want === god.pose) return;
    const from = Math.max(t + down, god.shownAt + dwell(god, t));
    const step = god.c.step;
    const at = god.beat0 + Math.ceil((from - god.beat0 - 1e-6) / step) * step;
    god.swap = sim.at(at, () => swap(god, at));
    // The frames she comes down on begin here.
    if (down) god.nudge = sim.at(at - down, () => {});
  }

  // The cut: the pose is whatever the record asks for at this moment.
  function swap(god: God, t: number): void {
    god.swap = null;
    god.nudge = null;
    if (!working(god)) return;
    if (god.want === god.pose) {
      god.upAt = t; // not after all: she was down for the cut, and rises again
      return settle(god, t);
    }
    calm(god, t);
    show(god, god.want, t);
    endStart(god, t); // a start under way ends at a cut, and one not begun is dropped
    god.cuts.push(t);
    while (god.cuts[0]! <= t - STORM.within + 1) god.cuts.shift(); // on a beat, to the ms: not within
    if (god.cuts.length >= STORM.cuts) god.storm = true;
    settle(god, t); // a reaction under way ends here; one waiting on this cut begins after it
  }

  function show(god: God, pose: Skill, t: number): void {
    god.pose = pose;
    god.shownAt = t;
    god.upAt = t;
    const scales = god.c.acts.think.verdict;
    if (scales && (pose === scales.confirmed || pose === scales.dropped)) god.lean = pose;
  }

  // How far off the floor the one who flies is at her work: up as her pose
  // cuts in, to her lift or to the height her fidget rides at (`to`), and down
  // again in time for the cut that is coming; down for her crown, as for a
  // cut, and up again after it. Under reduced motion she is simply up, and
  // simply down for her crown. `bare`, her height with no crown: whether an
  // ending finds her up.
  function aloft(god: God, now: number, to?: number | null, bare = false): number {
    const lift = working(god) ? liftOf(god) : 0;
    if (!lift) return 0;
    const c = bare ? null : crowning(god);
    if (reduced()) return c && now >= c.start && now < endOf(god, c) ? 0 : lift;
    let h = (to ?? lift) * outCubic(clamp01((now - god.upAt) / HOVER_UP));
    if (c) {
      const end = endOf(god, c);
      if (now < end) h *= 1 - smooth((now - (c.start - HOVER_DOWN)) / HOVER_DOWN);
      else h *= outCubic(clamp01((now - end) / HOVER_UP));
    }
    if (god.swap) h *= 1 - smooth((now - (god.swap.t - HOVER_DOWN)) / HOVER_DOWN);
    return h;
  }

  // ───────── fidgets: a god alive at its work ─────────
  // The move a bar of idling was dealt: by dice of the god's own, seeded from
  // its agent, its pose, the cut that showed it and the bar. Never the
  // floor's dice, so a frame is still the clock's alone; kept, so each bar is
  // dealt once.
  function dealt(god: God, f: Fidget, n: number): Dealt | null {
    const held = `${god.pose} ${god.shownAt}`;
    const { deals } = god;
    if (deals.held !== held || deals.bars.size > 64) deals.bars.clear();
    deals.held = held;
    let d = deals.bars.get(n);
    if (d === undefined) {
      const dice = rng(hash(`${god.key} ${god.pose} ${Math.round(god.shownAt)} ${n}`));
      deals.bars.set(n, (d = deal(f, n, dice)));
    }
    return d;
  }

  // A god's fidget at `now`, as numbers, and when it will next move the god
  // of itself: `now` while a figure eases, the moment of its next key, or
  // never. Only at its work; under reduced motion, or switched off, never.
  // Times are in the god's own beats, counted from the cut that showed the
  // pose. Nothing is put on the clock for it. It rests while a reaction stills
  // it, until the first bar after: then it will next move in that bar.
  const AT_REST = { s: null, wake: Infinity } as const;
  function fidget(
    god: God,
    now: number,
    quiet: boolean,
  ): { readonly s: FidgetAt | null; readonly wake: number } {
    const f = fidgeting && !quiet && working(god) ? god.c.fid[god.pose as Skill] : undefined;
    if (!f) return AT_REST;
    const step = god.c.step;
    const lift = liftOf(god);
    // The one who flies comes down for a cut, or for her crown, as she is: her
    // wings still, from the height she had.
    let down = god.swap && lift ? god.swap.t - HOVER_DOWN : Infinity;
    const c = lift ? crowning(god) : null;
    if (c && now < endOf(god, c)) down = Math.min(down, c.start - HOVER_DOWN);
    const at = Math.min(now, down);
    const deals = (n: number): Dealt | null => dealt(god, f, n);
    const resting = god.hush.length > 0 || god.start !== null;
    const rest = resting ? hushedUntil(god, at) : null;
    if (rest !== null) {
      if (rest === Infinity || now >= down) return AT_REST;
      const from = (rest - god.shownAt) / step;
      const wake = god.shownAt + Math.max(nextAt(f, from, step, deals), from) * step;
      return { s: null, wake: wake < down ? wake : Infinity };
    }
    const b = (at - god.shownAt) / step;
    const fresh = resting ? (n: number): boolean => resumes(god, n * f.bar) : undefined;
    let s = fidgetAt(f, b, step, lift, deals, fresh);
    if (s && (now >= down || !god.seconds.has(god.pose))) s = { ...s, frame: "" };
    if (now >= down) return { s: s && { ...s, turn: false }, wake: Infinity };
    const next = nextAt(f, b, step, deals);
    const wake = next <= b ? now : god.shownAt + next * step;
    return { s, wake: wake < down ? wake : Infinity }; // from there the cut's own frames run
  }

  // ───────── notices: the gods notice each other ─────────
  // Only a record changing starts one (notice(), from land() and reconcile()),
  // and only in a god at its work. A reaction is a record on the god, when it
  // begins and what it is, and the frames are worked out from it and the time,
  // as a fidget's are: nothing is put on the clock for it, so it never delays
  // a cut, and a cut of the god's own ends it. It begins on the god's
  // quarter-beat, a quarter-beat after the event; if a cut of its own is
  // coming, after that cut has landed; and not at all if that is too late.
  const atWork = (g: God): boolean => out(g) && !g.ending && working(g);
  // When a reaction that has begun is over: its beats, twice as many under
  // reduced motion, unless a cut or an ending came first.
  const endOf = (god: God, r: Reaction): number => over(r, god.c.step, reduced() ? 2 : 1);
  // Her crown in the pose she is in, if it has begun or is due.
  function crowning(god: God): Begun | null {
    const c = god.crowned;
    return c && !c.off && c.start !== null && c.shownAt === god.shownAt ? (c as Begun) : null;
  }

  function reactingNow(god: God, t: number): boolean {
    const r = god.react;
    if (!r || r.off) return false;
    return r.start === null ? t <= r.late : r.shownAt === god.shownAt && t < endOf(god, r);
  }

  // Until when its fidget rests for a reaction or a start at t, in the pose it
  // is in, if it does; and whether a bar (b beats from the cut) is the one it
  // starts again with.
  const hushes = (god: God): Hush[] => god.hush.filter((w) => w.at === god.shownAt && !w.r.off);
  function rests(god: God): readonly Rest[] {
    const held = hushes(god);
    const s = startHush(god);
    return s ? [...held, s] : held;
  }
  function hushedUntil(god: God, t: number): number | null {
    let until: number | null = null;
    for (const w of rests(god))
      if (t >= w.from && t < w.until) until = Math.max(until ?? -Infinity, w.until);
    return until;
  }
  const resumes = (god: God, b: number): boolean =>
    rests(god).some((w) => Math.abs(w.until - (god.shownAt + b * god.c.step)) < 1e-3);

  // A record has changed: the gods near it may notice. The nearest god at its
  // work on each side, within reach of its head line, not already reacting
  // and not one that noticed lately, by dice of its own (the two agents and
  // the event: never the floor's) and its nature. For a finish, the nearest
  // Nike at her work who is free gives her crown instead, wherever she is; if
  // none is free, one armed this very moment for a farther finish turns to
  // the nearer.
  function notice(ev: God, kind: Noticed, t: number): void {
    if (!reacting) return;
    const x = xAt(ev, t);
    const others = [...gods.values()].filter((g) => g !== ev && atWork(g));
    let crowner: God | null = null;
    if (kind === "done") {
      const far = (g: God): number => Math.abs(g.x - x);
      const nikes = others.filter((g) => crownOf(g.gid)).sort((a, b) => far(a) - far(b));
      crowner =
        nikes.find((g) => !reactingNow(g, t)) ??
        nikes.find((g) => {
          const r = g.react!;
          return r.crown && r.at === t && far(g) < Math.abs(r.x - g.x);
        }) ??
        null;
      if (crowner) arm(crowner, ev, kind, x, t, true);
    }
    for (const side of [-1, 1]) {
      let near: God | null = null;
      for (const g of others) {
        const d = (g.x - x) * side;
        if (d > 0 && d <= N.reach && (!near || d < (near.x - x) * side)) near = g;
      }
      if (!near || near === crowner || reactingNow(near, t)) continue;
      const last = near.noticed;
      if (last && !last.off && last.start !== null && t - last.start < N.rest) continue;
      if (rng(hash(`${near.key} ${ev.key} ${kind}`))() >= near.c.chance[kind]) continue;
      arm(near, ev, kind, x, t, false);
    }
  }

  function arm(god: God, ev: God, kind: Noticed, x: number, t: number, crown: boolean): void {
    endStart(god, t); // the records win: a start gives way to a notice or the crown at once
    const old = god.react;
    if (old && !old.off && (old.start === null || old.start > t)) old.off = true; // not begun: replaced
    const r = armed(
      ev.key,
      kind,
      x,
      t,
      N.late,
      N.beats[kind],
      crown ? crownOf(god.gid) : undefined,
    );
    god.react = r;
    if (crown) god.crowned = r;
    if (!god.swap) begin(god, r, t);
  }

  // When and how a reaction begins, now that no cut of its own is coming
  // first. The one who flies is down for her crown when it begins. A lean
  // begins from wherever its fidget has the figure then. Its fidget rests
  // from then until the first bar after it is over; a move on the cut doesn't
  // come back.
  function begin(god: God, r: Reaction, t: number): void {
    const step = god.c.step;
    const quiet = reduced();
    const pose = god.pose as Skill;
    const down = r.crown && liftOf(god) && !quiet ? HOVER_DOWN : 0;
    const start = quarter(god.beat0, step, t + step / 4 + down);
    if (start > r.late) {
      r.off = true;
      return;
    }
    const front = Math.sign(r.x - god.x) === god.dir;
    const from = r.crown || quiet ? null : fidget(god, start - 1e-3, false).s;
    begun(r, start, god.shownAt, front, god.c.nt[pose]!, N.ease, step, from);
    god.noticed = r;
    god.hush = hushes(god);
    const until = hushUntil(god.c.fid[pose], god.shownAt, start + r.beats * step, step);
    if (until !== null) god.hush.push({ r, at: god.shownAt, from: start, until });
  }

  // A cut of the god's own has landed (swap), or its record has changed
  // (heed): a reaction under way when a cut lands ends there, as a fidget
  // does; one not begun begins after the cut, or waits for the one coming.
  function settle(god: God, t: number): void {
    const r = god.react;
    if (!r || r.off) return;
    const cut = r.start !== null && r.shownAt !== god.shownAt;
    if (cut && r.start! <= t) r.end = Math.min(r.end, t);
    else if (cut || r.start === null) {
      r.start = null;
      if (!god.swap) begin(god, r, t);
    }
  }

  // It leaves its work: a reaction ends with it (at `at`), and one not begun never does.
  function endReact(god: God, t: number, at = t): void {
    const r = god.react;
    if (!r || r.off) return;
    if (r.start === null || r.start > t) r.off = true;
    else r.end = Math.min(r.end, at);
  }

  // ───────── startles: the reader presses a god at its work ─────────
  // A click on a god, or Enter or Space on it, leaves a mark and wakes the
  // clock: nothing is put on it. The frame that follows begins the start, at
  // its own moment (poke()). Only in a god at its work, and not in a notice or
  // a crown, begun or armed; a press on any other, or on one already starting,
  // does nothing more than its card does. A start is a record on the god, as
  // a reaction is, in a slot of its own, and each frame is worked out from it
  // and the time. It begins on the god's first quarter-beat at or after the
  // press.
  function press(god: God): void {
    if (disposed || !startOf(god.gid)) return;
    pressed.add(god);
    sim.wake();
  }

  // When a start is over: its beats, twice as many under reduced motion,
  // unless something ended it first.
  const startEnd = (god: God, s: Start): number => startOver(s, god.c.step, reduced() ? 2 : 1);

  // Where a god's start reaches, band by band, as it faces at its place, `up` off the floor.
  function startBoxes(god: God, st: StartOf, up: number): Box[] {
    const left = god.dir < 0;
    return st.ol.map(([y, a, b]) => ({
      x0: god.x + (left ? AXIS - b : a),
      x1: god.x + (left ? AXIS - a : b),
      y0: TOP + y - up,
      y1: TOP + y + 2 - up,
    }));
  }

  // The reader pressed it: it starts, unless it may not. Startled again within
  // a while of its last start, it starts smaller: no hop, fewer beats. The one
  // who flies starts at the height she has, with no hop. Never where a line
  // held out, or kept for one, comes near it, hopped: a start is no part of
  // the envelope the lines keep clear of.
  function poke(god: God, t: number): void {
    const st = startOf(god.gid);
    if (!st || !atWork(god) || reactingNow(god, t)) return;
    const was = god.start && !god.start.off ? god.start : null;
    const last = was ? startEnd(god, was) : god.startLast;
    if (was && t < last) return; // already starting
    const step = god.c.step;
    const start = quarter(god.beat0, step, t);
    const small = start - last < ST.again;
    const lift = liftOf(god);
    const hop = small || lift ? 0 : st.hop;
    const boxes = startBoxes(god, st, lift || hop);
    if (ribbons(god).some((r) => boxes.some((b) => grazes(r, b, ST.line)))) return;
    god.startLast = last;
    god.start = {
      at: t,
      start,
      end: Infinity,
      off: false,
      shownAt: god.shownAt,
      beats: small ? ST.againBeats : st.beats,
      hop,
      small,
      lift: lift ? (fidget(god, start - 1e-3, reduced()).s?.lift ?? lift) : null,
    };
  }

  // A cut of its own, its leaving its work, a notice or the crown armed for
  // it, or a line put out near it: a start under way ends here, and one not
  // yet begun never does.
  function endStart(god: God, t: number): void {
    const s = god.start;
    if (!s || s.off) return;
    if (s.start >= t) s.off = true;
    else s.end = Math.min(s.end, t);
  }

  // A line has been put out, or room kept for one: a start it comes near ends
  // at once, and one not yet begun there never does.
  function lineOut(god: God, r: Rib | null, t: number): void {
    if (!r) return;
    for (const g of gods.values()) {
      const s = g.start;
      const st = startOf(g.gid);
      if (g === god || !st || !s || s.off || t >= startEnd(g, s)) continue;
      if (startBoxes(g, st, liftOf(g) || s.hop).some((b) => grazes(r, b, ST.line))) endStart(g, t);
    }
  }

  // When its fidget rests for a start, in the pose it is in: from the start
  // until the first bar after it is over.
  function startHush(god: God): Rest | null {
    const s = god.start;
    if (!s || s.off || s.shownAt !== god.shownAt) return null;
    const step = god.c.step;
    const until = hushUntil(god.c.fid[god.pose as Skill], god.shownAt, startEnd(god, s), step);
    return until === null ? null : { from: s.start, until };
  }

  // What a god at its work shows at `now`: its start if it is in one, else its
  // reaction if it is in one, else its fidget; and when it will next be drawn
  // otherwise: a start or a reaction that is due begins on a frame of its own.
  function motion(
    god: God,
    now: number,
    quiet: boolean,
  ): { readonly shown: Shown; readonly react: How | "start" | ""; readonly wake: number } {
    const lift = liftOf(god);
    const s = god.start && !god.start.off ? god.start : null;
    const hop = s && started(s, now, god.c.step, quiet, ST.down);
    if (hop) return { shown: hop.shown, react: "start", wake: hop.wake };
    const r = reacting ? god.react : null;
    const live = r && !r.off && r.start !== null && r.shownAt === god.shownAt ? (r as Begun) : null;
    const at = live && played(live, now, god.c.step, quiet, lift);
    if (live && at) return { shown: at.shown, react: live.how!, wake: at.wake };
    const f = fidget(god, now, quiet);
    const due = live && now < live.start && !(quiet && live.move) ? live.start : Infinity;
    const jump = s && now < s.start ? s.start : Infinity;
    return { shown: shownAs(f.s, lift), react: "", wake: Math.min(f.wake, due, jump) };
  }

  // At its place: it starts its work, in the pose its record asks for now, and
  // facing the middle. Its beat and its dwell count from here.
  function work(god: God, t: number): void {
    halt(god, t);
    const seat = god.seat!;
    // Not into a line held out across its place: it waits for that to be furled.
    const held = ribbons(god);
    god.pose = "stand";
    if (held.length && reach(god, seat).some((b) => held.some((q) => grazes(q, b))))
      return wait(god, t, (t2) => (god.ending ? outro(god, t2) : toSeat(god, t2, true)));
    god.x = seat;
    god.dir = god.face; // it walked facing where it went; at its work it faces the middle
    show(god, god.want, t);
    god.beat0 = t;
    god.cuts.length = 0;
    god.storm = false;
    enter(god, "work", t, Infinity);
  }

  // It leaves its work, to step aside or for its ending: the cut that was
  // coming is dropped, its fidget, its reaction and its start with it, and
  // the one who flies comes down first. Then it stands. Whether she comes down first is
  // her height with no fidget and no crown, so an ending falls when it would
  // without them; she comes down from the height she had, and if she was
  // crowning on the floor, holds the crown until then.
  function quit(god: God, t: number, then: (t: number) => void): void {
    const quiet = reduced();
    const up = aloft(god, t, null, true) > 0 && !quiet;
    const m = motion(god, t, quiet);
    const h = up ? aloft(god, t, m.shown.lift) : 0;
    const crowned = m.react === "crown" && up ? m.shown.turn : null;
    endReact(god, t, crowned !== null ? t + HOVER_DOWN : t);
    endStart(god, t);
    uncue(god);
    if (up) return void enter(god, "alight", t, HOVER_DOWN, { h, then, crowned });
    god.pose = "stand";
    then(t);
  }

  // Where a walk has got to becomes where the god is; a step that follows sets its own facing.
  function halt(god: God, t: number): void {
    const s = god.seg;
    if (s?.kind !== "walk" || s.halted) return;
    god.x = walkX(s, t);
    god.dir = Math.sign(s.x1! - s.x0!) || god.dir;
    s.halted = true;
  }

  // A step of a god's turn. Whatever it was doing is over: a cut that was
  // coming is dropped, so neither an ending nor a step aside waits for a dwell.
  function enter(
    god: God,
    kind: Seg["kind"],
    t: number,
    dur: number,
    extra: Partial<Seg> = {},
  ): Seg {
    halt(god, t);
    uncue(god);
    sim.cancel(god.seg?.timer);
    sim.cancel(god.seg?.nudge);
    const seg: Seg = { kind, t0: t, t1: t + dur, ...extra };
    god.seg = seg;
    if (Number.isFinite(seg.t1)) {
      seg.timer = sim.at(seg.t1, () => {
        if (god.seg === seg && !god.gone) next(god, seg);
      });
    }
    return seg;
  }

  function next(god: God, seg: Seg): void {
    const t = seg.t1;
    switch (seg.kind) {
      case "assemble":
        return god.ending ? outro(god, t) : speak(god, t, "greet");
      case "greet":
        unsay(god);
        return god.ending ? outro(god, t) : toSeat(god, t);
      case "walk":
        halt(god, t);
        god.pose = "stand";
        if (seg.glanceTo != null)
          return void enter(god, "glance", t, GLANCE, { to: seg.glanceTo, purpose: seg.purpose });
        if (seg.purpose === "leave") return depart(god, t);
        return god.ending ? outro(god, t) : toSeat(god, t);
      case "glance":
        if (seg.purpose === "leave") return walk(god, t, seg.to!, "leave", true);
        return god.ending ? outro(god, t) : toSeat(god, t, true);
      case "alight":
        god.pose = "stand";
        return seg.then?.(t);
      case "report":
        unsay(god);
        god.pose = "stand";
        return seal(god, t);
      case "seal":
        god.sealed = true;
        return leave(god, t);
      case "fail":
        god.dim = 1;
        god.crack = god.ending === "fail" ? 1 : 0;
        return depart(god, t);
      case "unset":
        return remove(god, t);
      case "hold":
        return seg.then?.(t);
      default:
        return undefined;
    }
  }

  // It stands while the seal is pressed on its scroll; under reduced motion the seal is simply on.
  function seal(god: God, t: number): void {
    const quiet = reduced();
    if (quiet) god.sealed = true;
    enter(god, "seal", t, quiet ? SEALED_STILL : SEALED);
  }

  function land(god: God, t: number, at: Entry): void {
    god.landed = true;
    god.x = at.x;
    god.line = at.text;
    god.waiting = null;
    god.rib = at.r; // the room for its greeting is kept for it
    lineOut(god, at.r, t);
    god.dir = at.r ? at.r.side : facing(at.x);
    god.pose = "speak";
    godsEl.append(god.el);
    namesEl.append(god.label);
    god.labelW = measure(god.label);
    roveFix();
    takeDown(god, t);
    notice(god, "arrive", t);
    // It is set from its tesserae, shows through them, and then greets; under
    // reduced motion it is there, greeting.
    if (reduced()) return speak(god, t, "greet");
    enter(god, "assemble", t, ASSEMBLE + REVEAL);
  }

  function speak(god: God, t: number, kind: Saying): void {
    halt(god, t);
    const x = god.x;
    const report = kind === "report";
    // Ended while it waited for room to greet: it has nothing to say now.
    if (!report && god.ending) return ending(god, t);
    const near = around(god, t);
    const fits = (text: string): Rib | null => placeRibbon(god, x, text, near);
    let r: Rib | null;
    if (report) r = pickLine("farewell", god, fits)?.r ?? null;
    else if (god.line)
      // The room kept for its greeting, if nothing has come into it; else wherever the line fits.
      r = god.rib && clear(god, x, god.rib, near) ? god.rib : fits(god.line);
    else r = pickLine("greeting", god, fits)?.r ?? null;
    if (!r) {
      god.rib = null;
      god.waiting ??= t;
      const waited = t - god.waiting;
      // Room only for a line just said: it won't say that again, and won't wait long for another.
      const stale =
        !god.line &&
        LINES[report ? "farewell" : "greeting"].some(
          ([text, who]) => (who === god.gid || who === "*") && fits(text),
        );
      const limit = stale ? BYE_STUCK : report ? BYE_WAIT : GREET_WAIT;
      god.pose = "stand"; // standing by, waiting for room to say it
      if (waited < limit && !(report && waited >= BYE_STUCK && stuck(god)))
        return wait(god, t, (t2) => speak(god, t2, kind));
      // No room came: it goes on without a word.
      god.waiting = null;
      god.line = null;
      if (!report) return god.ending ? ending(god, t) : toSeat(god, t);
      return seal(god, t);
    }
    god.waiting = null;
    god.rib = r;
    lineOut(god, r, t);
    god.dir = r.side;
    god.pose = "speak";
    const el = ribbonEl(r.text, r.side);
    const [hx, hy] = god.c.hand;
    if (r.side > 0) el.style.left = `${(hx - 2).toFixed(1)}px`;
    else el.style.right = `${(CAST.cell.w - (AXIS - hx) - 2).toFixed(1)}px`;
    el.style.top = `${(hy - 9.5 - r.lift).toFixed(1)}px`;
    el.style.transform = `rotate(${-r.side * TILT}deg)`;
    // It unrolls from the hand, is held whole, and is furled; under reduced motion it shows whole.
    const quiet = reduced();
    el.style.setProperty("--oly-u", quiet ? "1" : "0");
    god.el.append(el);
    god.ribbon = el;
    god.out.u = null;
    god.said = r.text;
    god.line = null;
    const dur = quiet ? SAID : UNFURL + SAY + FURL;
    const seg = enter(god, report ? "report" : "greet", t, dur);
    // The frames it is furled on begin here.
    if (!quiet) seg.nudge = sim.at(t + dur - FURL, () => {});
  }

  function unsay(god: God): void {
    god.ribbon?.remove();
    god.ribbon = null;
    god.rib = null;
  }

  // Whether nothing on the lane will move to make room for a farewell: everyone
  // else is at their place or waiting to say one too, and this god has waited
  // longest. Then it goes without a word, and its going makes room for the rest.
  function stuck(god: God): boolean {
    for (const g of gods.values()) {
      if (g === god || !out(g)) continue;
      const k = g.seg?.kind;
      if (!g.ending && k === "work") continue;
      if (k !== "hold" || g.ending !== "done" || g.waiting == null) return false;
      if (g.waiting < god.waiting! || (g.waiting === god.waiting && g.x < god.x)) return false;
    }
    return true;
  }

  // No room yet, for a line, a walk or the tesserae: it stays as it is and looks again in a moment.
  function wait(god: God, t: number, then: (t: number) => void, why?: "unset"): void {
    enter(god, "hold", t, HOLD, { then, why });
  }

  // It glides to where it is going, in steps of stride and stand. An ambler or
  // a watchman may stop partway, a whole number of steps in, to look round.
  function walk(
    god: God,
    t: number,
    to: number,
    purpose: "seat" | "leave",
    glanced: boolean,
  ): void {
    halt(god, t);
    const from = god.x;
    // Not into a line being said, or kept for one: it waits until that is furled.
    if (ribbons(god).some((q) => across(q, way(god, from, to))))
      return wait(god, t, (t2) =>
        purpose === "leave"
          ? leave(god, t2)
          : god.ending
            ? outro(god, t2)
            : toSeat(god, t2, glanced),
      );
    const { speed, pause, ease } = god.c.move;
    const dist = Math.abs(to - from);
    const stride = (speed * god.c.step) / 1000;
    let x1 = to;
    let glanceTo: number | null = null;
    if (!glanced && pause > 0 && dist > stride * 3 && random() < pause) {
      const steps = 1 + Math.floor(random() * (Math.floor(dist / stride) - 1));
      x1 = from + Math.sign(to - from) * steps * stride;
      glanceTo = to;
    }
    god.dir = Math.sign(x1 - from) || god.dir;
    // To the ms: every step of a run falls on a whole one.
    enter(god, "walk", t, Math.round((Math.abs(x1 - from) / speed) * 1000), {
      x0: from,
      x1,
      ease: EASE[ease],
      purpose,
      glanceTo,
    });
  }

  // To its place, and to work there. Under reduced motion it is in its place at once.
  function toSeat(god: God, t: number, glanced = false): void {
    halt(god, t);
    if (reduced() || Math.abs(god.seat! - god.x) < 1.5) return work(god, t);
    walk(god, t, god.seat!, "seat", glanced);
  }

  // A god moved over to make room: it leaves its work and goes when it can.
  function reseat(god: God, seat: number, t: number): void {
    god.seat = seat;
    const s = god.seg;
    if (!s || !god.landed || god.ending) return;
    if (s.kind === "work")
      quit(god, t, (t2) => (god.ending ? outro(god, t2) : toSeat(god, t2, true)));
    else if (s.kind === "walk" && s.purpose === "seat") walk(god, t, seat, "seat", true);
  }

  // Its ending, from its work: the one who flies comes down first.
  function outro(god: God, t: number): void {
    if (working(god)) return quit(god, t, (t2) => ending(god, t2));
    ending(god, t);
  }

  // Done, it says its farewell; failed or stopped, it stands and dims.
  function ending(god: God, t: number): void {
    if (god.ending === "done") return speak(god, t, "report");
    halt(god, t);
    unsay(god);
    god.pose = "stand";
    if (reduced()) {
      god.dim = 1;
      god.crack = god.ending === "fail" ? 1 : 0;
    }
    enter(god, "fail", t, FAIL_HOLD);
  }

  // Where a god walks off to: a few strides toward the nearer end of the lane,
  // if there is room, else the other way. Null if it is hemmed in.
  function exitFor(god: God, t: number): number | null {
    const [lo, hi] = body(god, t);
    const half = (hi - lo) / 2;
    let wallL = edgeL - half;
    let wallR = edgeR + half;
    for (const [a, b] of claims(god, t)) {
      if (b <= lo + 2) wallL = Math.max(wallL, b + 26);
      else if (a >= hi - 2) wallR = Math.min(wallR, a - 26);
    }
    const room = (dir: number): number => (dir < 0 ? lo - wallL : wallR - hi);
    const stride = (god.c.move.speed * god.c.step) / 1000;
    const near = (lo + hi) / 2 < W / 2 ? -1 : 1;
    const dir = room(near) >= stride ? near : room(-near) >= stride * 1.5 ? -near : 0;
    if (!dir) return null;
    return god.x + dir * Math.min(stride * (3 + Math.floor(random() * 2)), room(dir));
  }

  // Sealed: its place is free for whoever comes next, and it walks off.
  function leave(god: God, t: number): void {
    god.seat = null;
    const to = reduced() ? null : exitFor(god, t);
    if (to === null) return depart(god, t);
    walk(god, t, to, "leave", false);
  }

  // It goes back to tesserae, where it stands; at once under reduced motion.
  // Failed, it crumbles. Done or stopped, they fly up and out, and not through
  // another god's ribbon: it waits until that is furled.
  function depart(god: God, t: number): void {
    halt(god, t);
    god.seat = null;
    if (reduced()) return remove(god, t);
    if (god.ending === "fail") return void enter(god, "unset", t, CRUMBLE_END, { how: "fall" });
    god.pose = "stand";
    const [a, b] = either(god, "stand", god.x);
    if (ribbons(god).some((q) => across(q, [a - SCATTER, b + SCATTER])))
      return wait(god, t, (t2) => depart(god, t2), "unset");
    enter(god, "unset", t, UNSET_END, { how: "lift" });
  }

  function remove(god: God, t: number): void {
    god.gone = true;
    sim.cancel(god.seg?.timer);
    sim.cancel(god.seg?.nudge);
    uncue(god);
    god.seat = null;
    refocus(god.el, drawnX(god));
    god.el.remove();
    god.label.remove();
    gods.delete(god.key);
    if (hoverKey === god.key) hoverKey = null;
    if (overKey === god.key) overKey = null;
    if (focusKey === god.key) focusKey = null;
    if (dismissed === god.key) dismissed = null;
    roveFix();
    const i = queue.indexOf(god);
    if (i >= 0) queue.splice(i, 1);
    const k = pool.indexOf(god);
    if (k >= 0) pool.splice(k, 1);
    takeDown(god, t); // ended before it was set: its medallion goes as it would have
    // Sent on again while it was going: it is summoned again.
    const a = latest.find((o) => o.key === god.key);
    if (a?.look === "run") summon(a, t);
    drawPool(t);
    maybeClose(t);
  }

  function finish(god: God, kind: Ending, t: number): void {
    if (god.ending) return;
    god.ending = kind;
    // Finished before it ever landed: it never comes out.
    if (!god.landed) return remove(god, t);
    if (working(god)) outro(god, t);
    // anything else it finishes first; next() sees the ending
  }

  // ───────── waiting for a place ─────────
  // A record waits unseen if anyone is waiting already, so nobody overtakes
  // it; if five gods that aren't ending are on the lane or waiting to land; or
  // if its place couldn't be planned without two places overlapping.
  const working5 = (except: God): number =>
    [...gods.values()].filter(
      (g) => g !== except && !g.ending && !g.gone && (g.landed || queue.includes(g)),
    ).length;

  function fitsOn(god: God): boolean {
    const others = byseat().filter((g) => !g.ending);
    if (!others.length) return true;
    const face = god.face;
    const best = gapFor(god, others);
    god.face = best.face;
    const all: Placed[] = [...others.map((g) => ({ g, x: g.seat })), { g: god, x: best.x }].sort(
      (a, b) => a.x - b.x,
    );
    const ok = spread(all, new Set()) !== null;
    god.face = face;
    return ok;
  }

  // While fewer than five gods are on the lane or wait to land, the oldest
  // waiting goes to the landing queue.
  function drawPool(t: number): void {
    while (pool.length) {
      const held = [...gods.values()].filter(
        (g) => !g.gone && (g.landed || queue.includes(g)),
      ).length;
      if (held >= CAPACITY || !fitsOn(pool[0]!)) return;
      queue.push(pool.shift()!);
      scheduleLanding(t);
    }
  }

  function summon(a: LaneAgent, t: number): void {
    const god = makeGod(a);
    gods.set(a.key, god);
    if (pool.length > 0 || working5(god) >= CAPACITY || !fitsOn(god)) {
      pool.push(god);
      pooledAt.set(god, t);
      widen(t);
      hangAll(t);
      return;
    }
    queue.push(god);
    openLane(t);
    scheduleLanding(t);
  }

  // ───────── the pool's medallions ─────────
  // Nothing here is put on the clock, and no dice are thrown: a medallion's
  // moments are worked out from when it was hung and taken down, by whichever
  // step or frame comes next, so they fall the same however the frames do.
  const slotY = (slot: number): number => POOL.y + slot * POOL.pitch;
  function slideY(m: Medal, now: number): number {
    const to = slotY(m.slot);
    if (!m.slide) return to;
    return lerp(m.slide.from, to, smooth((now - m.slide.t0) / POOL.slide));
  }

  const inBar = (m: Medal): boolean => m.downAt === null;

  // ───────── a medallion rocks on its peg ─────────
  // A click on one, or Enter or Space on it, leaves a mark and wakes the clock,
  // as a press on a god does; the frame that follows begins the rock. One
  // hanging still cuts to its tilt, the bottom toward the lane, on its god's
  // next quarter-beat, counted from when it was hung, and swings back through
  // a part of that to rest over its god's start beats. Again within the
  // startle's again, a part of the tilt, for fewer beats. One being set,
  // taken down or moving up a slot ignores the press. Under reduced motion the
  // tilt is a still, held twice its beats. Each frame is worked out from the
  // record and the time.
  function knock(m: Medal): void {
    if (disposed || !startling) return;
    knocked.add(m);
    sim.wake();
  }
  const hangsStill = (m: Medal, t: number): boolean =>
    inBar(m) && (m.cut || t >= m.t0 + POOL.set + POOL.reveal) && !queue.includes(m.god);
  const rockEnd = (m: Medal, k: Rock): number =>
    Math.min(k.end, k.start + k.beats * m.god.c.step * (reduced() ? 2 : 1));
  function endRock(m: Medal, t: number): void {
    const k = m.rock;
    if (!k || k.off) return;
    if (k.start >= t) k.off = true;
    else k.end = Math.min(k.end, t);
  }
  function rock(m: Medal, t: number): void {
    if (!medals.includes(m) || !hangsStill(m, t)) return;
    if (m.slide && t < m.slide.t0 + POOL.slide) return; // moving up a slot
    const was = m.rock && !m.rock.off ? m.rock : null;
    const last = was ? rockEnd(m, was) : m.rockLast;
    if (was && t < last) return; // already rocking
    const start = quarter(m.t0, m.god.c.step, t);
    const small = start - last < ST.again;
    m.rockLast = last;
    m.rock = {
      start,
      end: Infinity,
      off: false,
      beats: small ? ST.againBeats : m.god.c.st.beats,
      tilt: m.side * m.god.c.medal.tilt * (small ? POOL.again : 1),
    };
  }
  function rockAt(m: Medal, now: number): number {
    const k = m.rock;
    if (!k || k.off || now < k.start || now >= rockEnd(m, k)) return 0;
    if (reduced()) return k.tilt;
    const u = (now - k.start) / (k.beats * m.god.c.step);
    return u < 0.5
      ? k.tilt * lerp(1, -POOL.back, smooth(u / 0.5))
      : -k.tilt * POOL.back * (1 - smooth((u - 0.5) / 0.5));
  }

  // Those whose time is up are gone, the earliest first; the ones under each
  // move up a slot, and whoever still waits unhung takes what that frees.
  function settleMedals(t: number): void {
    settlePiers(t);
    for (;;) {
      const m = medals
        .filter((o) => o.goneAt !== null && o.goneAt <= t)
        .sort((a, b) => a.goneAt! - b.goneAt!)[0];
      if (!m) return;
      const at = m.goneAt!;
      m.el.remove();
      medals.splice(medals.indexOf(m), 1);
      for (const o of medals) {
        if (o.side !== m.side || o.slot < m.slot) continue;
        const from = slideY(o, at);
        o.slot -= 1;
        o.slide = reduced() ? null : { from, t0: at };
        endRock(o, at);
      }
      hang(at);
    }
  }

  function hang(t: number): void {
    if (!showPool || !piers.wide) return; // a medallion hangs on a pier, not an anta
    for (const god of pool) {
      if (medals.some((m) => m.god === god)) continue;
      const used: Record<-1 | 1, number[]> = { [-1]: [], 1: [] };
      for (const m of medals) used[m.side].push(m.slot);
      const order = used[1].length <= used[-1].length ? ([1, -1] as const) : ([-1, 1] as const);
      const side = order.find((s) => used[s].length < POOL.slots);
      if (side === undefined) return; // every slot is taken: it waits unseen
      let slot = 0;
      while (used[side].includes(slot)) slot++;
      const el = html("div", "oly-medal");
      el.dataset.god = god.gid;
      el.dataset.key = god.key;
      // It has a name, and is in the gods' toolbar; until it hangs still it
      // has nothing to press, and says so.
      el.setAttribute("role", "button");
      el.tabIndex = -1;
      el.setAttribute("aria-label", CAST.gods[god.gid].name);
      el.setAttribute("aria-disabled", "true");
      const row = opts.describe?.(god.key);
      if (row) el.setAttribute("aria-describedby", row);
      const rim = html("span", "oly-medal-rim");
      const img = document.createElement("img");
      img.src = GODS[god.gid].cameo;
      img.alt = "";
      img.draggable = false;
      rim.append(img);
      el.append(rim);
      const cut = reduced();
      if (!cut) el.style.opacity = "0"; // under reduced motion it is never part way
      godsEl.append(el);
      const key = god.key;
      el.addEventListener("pointerenter", () => {
        overKey = hoverKey = key;
        stay();
        attend();
      });
      el.addEventListener("pointerleave", () => {
        if (overKey === key) overKey = null;
        if (dismissed !== key) return linger();
        // Esc hid its card: it stays hidden as the pointer goes, as a god's does.
        if (hoverKey === key) hoverKey = null;
        if (focusKey !== key) dismissed = null;
        attend();
      });
      el.addEventListener("click", () => {
        const m = medals.find((o) => o.el === el);
        if (m) knock(m);
      });
      medals.push({
        god,
        el,
        side,
        slot,
        t0: Math.max(t, pooledAt.get(god) ?? t),
        cut,
        downAt: null,
        goneAt: null,
        slide: null,
        drawn: "",
        focus: false,
        y: null,
        rock: null,
        rockLast: -Infinity,
        startable: false,
      });
      roveFix();
    }
  }

  // ───────── the piers ─────────
  // Both antae widen together, once an opening, and the floor's edges move in.
  // The edges move first, when the first god is pooled, so nobody plans a
  // place, a walk or a line under a pier; the antae widen once nothing is in
  // their way. They stay wide until the lane shuts.
  function widen(t: number): void {
    if (!showPool || piers.want) return;
    piers.want = true;
    edgeL = POOL.edge;
    edgeR = W - POOL.edge;
    stepIn(t);
    pierCheck(t);
  }

  function pierCheck(t: number): void {
    if (!piers.want || piers.t0 !== null) return;
    if (inTheWay(t)) return void later(t + HOLD, () => pierCheck(sim.now()));
    piers.t0 = t; // no wake: the frame after this step or these records draws it
  }

  // They are wide once they have widened: worked out from when they began, by
  // whichever step or frame comes next, and whoever waits is hung as of then.
  const wideAt = (): number =>
    piers.t0 === null ? Infinity : reduced() ? piers.t0 : piers.t0 + POOL.widen;
  function settlePiers(t: number): void {
    const at = wideAt();
    if (piers.wide || t < at) return;
    piers.wide = true;
    hang(at);
  }

  // Whether a pier widening now would come over a god, its place or its line.
  // A god going off the lane, or back to tesserae, goes behind it anyway.
  function inTheWay(t: number): boolean {
    const lo = POOL.pier;
    const hi = W - POOL.pier;
    for (const g of gods.values()) {
      if (!g.landed || g.gone) continue;
      const s = g.seg;
      const k = s?.kind;
      if ((k === "walk" || k === "glance") && s!.purpose === "leave") continue;
      if (k === "unset" || (k === "hold" && s!.why === "unset")) continue;
      const [a, b] = body(g, t);
      if (a < lo || b > hi) return true;
      if (g.rib && (g.rib.x0 < lo + RIB_PAD || g.rib.x1 > hi - RIB_PAD)) return true;
      if (g.seat != null && !g.ending) {
        const [e0, e1] = envOf(g);
        if (g.seat + e0 < lo || g.seat + e1 > hi) return true;
      }
    }
    return false;
  }

  // Whoever's place would cross the new edges steps in, the least it can.
  function stepIn(t: number): void {
    const all: Placed[] = byseat().map((g) => ({ g, x: g.seat }));
    const out = (o: Placed): boolean => o.x < seatMin(o.g) - 1e-6 || o.x > seatMax(o.g) + 1e-6;
    if (!all.some(out)) return;
    const stay = new Set(all.filter((o) => o.g.ending).map((o) => o.g));
    let seats = spread(all, stay) ?? spread(all, new Set()) ?? all.map((o) => o.x);
    // Whoever would move only a little, and is inside the new edges, stays where it is if it can.
    for (let held = true; held;) {
      held = false;
      const few = all
        .map((o, i) => ({ o, d: Math.abs(seats[i]! - o.x) }))
        .filter(({ o, d }) => !stay.has(o.g) && d > 0.5 && d <= SHIFT_MIN && !out(o))
        .sort((a, b) => a.d - b.d);
      for (const { o } of few) {
        stay.add(o.g);
        const tried = spread(all, stay);
        if (tried) {
          seats = tried;
          held = true;
          break;
        }
        stay.delete(o.g);
      }
    }
    all.forEach((o, i) => {
      if (Math.abs(seats[i]! - o.x) > 0.5) reseat(o.g, seats[i]!, t);
    });
  }

  // The lane has shut: the antae and the edges are as they were.
  function narrow(): void {
    Object.assign(piers, { want: false, t0: null, wide: false });
    edgeL = EDGE;
    edgeR = W - EDGE;
    if (piers.w === "") return;
    piers.w = "";
    for (const a of antae) a.style.width = "";
  }

  // An anta's width: the stylesheet's until they widen, then each frame's.
  function pierAt(now: number): number {
    if (piers.t0 === null) return POOL.anta;
    const k = reduced() ? 1 : clamp01((now - piers.t0) / POOL.widen);
    return lerp(POOL.anta, POOL.pier, smooth(k));
  }

  function renderPiers(now: number): boolean {
    const px = pierAt(now).toFixed(2);
    const w = Number(px) > POOL.anta ? `${px}px` : "";
    if (piers.w !== w) {
      piers.w = w;
      for (const a of antae) a.style.width = w;
    }
    return piers.t0 !== null && !piers.wide;
  }

  function hangAll(t: number): void {
    settleMedals(t);
    hang(t);
  }

  // Its god is being set, or its record has ended: the medallion is taken down.
  function takeDown(god: God, t: number): void {
    pooledAt.delete(god);
    const m = medals.find((o) => o.god === god);
    if (!m || m.downAt !== null) return;
    settleMedals(t);
    // Focus on it goes to its god as it is set; to the nearest left in the
    // toolbar if it ended waiting.
    if (m.el.contains(document.activeElement) && out(god)) {
      roveTo(god.el);
      god.el.focus({ preventScroll: true });
    } else refocus(m.el, medalX(m));
    endRock(m, t);
    m.downAt = t;
    m.goneAt = reduced() ? t : t + POOL.scatter;
    // Out of the toolbar the moment it is taken down.
    m.el.setAttribute("aria-hidden", "true");
    m.el.tabIndex = -1;
    if (rove === m.el) rove = null;
    roveFix();
    settleMedals(t);
  }

  // How far a medallion shows: nothing while it is set, then through; and out as it is taken down.
  function medalShown(m: Medal, now: number): number {
    const a = m.cut ? 1 : clamp01((now - m.t0 - POOL.set) / POOL.reveal);
    return m.downAt === null ? a : Math.min(a, 1 - clamp01((now - m.downAt) / UNSET));
  }
  const medalX = (m: Medal): number => (m.side < 0 ? POOL.x : W - POOL.pier + POOL.x);

  function renderMedals(now: number): boolean {
    settleMedals(now);
    if (!medals.length) return false;
    let moving = false;
    for (const m of medals) {
      if (m.slide && now >= m.slide.t0 + POOL.slide) m.slide = null;
      const a = medalShown(m, now);
      m.y = slideY(m, now);
      // Its tilt as it rocks, about its peg's top; none at rest.
      const rot = rockAt(m, now).toFixed(3);
      const tilt = Number(rot) === 0 ? "" : rot;
      const css = `${medalX(m).toFixed(2)},${m.y.toFixed(2)},${a.toFixed(3)},${tilt}`;
      if (css !== m.drawn) {
        m.drawn = css;
        // Written whole, so what the element says never depends on which frames fell.
        const to = `translate(${medalX(m).toFixed(2)}px,${m.y.toFixed(2)}px)`;
        const at = tilt
          ? `transform-origin: 50% -${POOL.peg}px; transform: ${to} rotate(${tilt}deg);`
          : `transform: ${to};`;
        m.el.style.cssText = Number(a.toFixed(3)) >= 1 ? at : `${at} opacity: ${a.toFixed(3)};`;
      }
      // Hanging still it can be rocked: then it is a button with something to press.
      const can = startling && hangsStill(m, now);
      if (can !== m.startable) {
        m.startable = can;
        m.el.classList.toggle("is-startable", can);
        if (can) m.el.removeAttribute("aria-disabled");
        else m.el.setAttribute("aria-disabled", "true");
      }
      const rocking = m.rock !== null && !m.rock.off && now < rockEnd(m, m.rock);
      if (
        rocking ||
        m.slide ||
        m.goneAt !== null ||
        (!m.cut && now < m.t0 + POOL.set + POOL.reveal)
      )
        moving = true;
    }
    return moving;
  }

  function clearMedals(): void {
    for (const m of medals) m.el.remove();
    medals.length = 0;
    knocked.clear();
    pooledAt.clear();
  }

  // ───────── landing ─────────
  function scheduleLanding(t: number, from = t): void {
    if (landTimer || !queue.length || !landable()) return;
    landTimer = sim.at(Math.max(from, readyAt, nextLandAt), () => {
      landTimer = null;
      landNext(sim.now());
    });
  }

  function landNext(t: number): void {
    const god = queue[0];
    if (!god || !landable()) return;
    const at = planSeat(god, t) ? entryFor(god, t) : null;
    if (!at) return scheduleLanding(t, t + RETRY);
    queue.shift();
    nextLandAt = t + LAND_GAP;
    land(god, t, at);
    scheduleLanding(t);
  }

  // ───────── one frame ─────────
  function put<T>(god: God, key: string, value: T, write: (value: T) => void): void {
    if (god.out[key] === value) return;
    god.out[key] = value;
    write(value);
  }

  // A god at `now`: its step, and how far into it the time is.
  function sample(god: God, now: number): Vis {
    const s = god.seg;
    const u = s ? now - s.t0 : 0;
    const quiet = reduced();
    const v: Vis = {
      x: god.x,
      y: 0,
      dir: god.dir,
      pose: god.pose,
      fig: 1,
      name: 1,
      rib: 1,
      dim: god.dim,
      crack: god.crack,
      sealed: god.sealed,
      press: 1,
      tiles: null,
      fid: STILL,
      react: "",
      moving: false,
      wake: Infinity,
    };
    switch (s?.kind) {
      case "assemble":
        // Asked for less motion on the way: it is simply there.
        if (quiet) break;
        v.fig = v.name = clamp01((u - ASSEMBLE) / REVEAL);
        v.tiles = {
          mode: u < ASSEMBLE ? "set" : "rest",
          pose: "speak",
          u,
          a: 1 - v.fig,
          dim: false,
        };
        v.moving = true;
        break;
      case "greet":
      case "report":
        if (quiet) break;
        v.rib = u < UNFURL ? outCubic(clamp01(u / UNFURL)) : clamp01((s.t1 - now) / FURL);
        v.moving = u < UNFURL || now >= s.t1 - FURL;
        break;
      case "walk": {
        if (s.halted) break;
        const { bob, lift } = god.c.move;
        v.x = walkX(s, now);
        v.dir = Math.sign(s.x1! - s.x0!) || god.dir;
        v.pose = Math.floor(u / god.c.step) % 2 === 0 ? "stride" : "stand";
        if (bob && v.pose === "stride") v.y = bob; // a heavy tread dips on its footfall
        if (lift) {
          // The one who flies skims the floor, and settles as she lands.
          const k = clamp01(u / Math.max(1, s.t1 - s.t0));
          v.y = -lift * clamp01(u / 140) * (k > 0.7 ? 1 - outCubic((k - 0.7) / 0.3) : 1);
        }
        v.moving = true;
        break;
      }
      case "glance":
        v.pose = "stand";
        if (u > 220 && u < GLANCE - 260) v.dir = -god.dir;
        v.moving = true;
        break;
      case "work": {
        const lift = liftOf(god);
        const m = motion(god, now, quiet);
        v.fid = m.shown;
        v.react = m.react;
        v.y = -aloft(god, now, v.fid.lift);
        if (v.fid.turn) v.dir = -god.dir; // an about-face, as the walk's look round is
        v.wake = m.wake;
        v.moving =
          m.wake <= now ||
          (lift > 0 &&
            !quiet &&
            (now < god.upAt + HOVER_UP || (god.swap !== null && now >= god.swap.t - HOVER_DOWN)));
        // The one who flies comes down for her crown, and rises after it.
        const c = lift > 0 && !quiet ? crowning(god) : null;
        if (c) {
          const end = endOf(god, c);
          const down = c.start - HOVER_DOWN;
          if (now < down) v.wake = Math.min(v.wake, down);
          else if (now < c.start || (now >= end && now < end + HOVER_UP)) v.moving = true;
        }
        break;
      }
      case "alight":
        v.y = -s.h! * (1 - smooth(u / HOVER_DOWN));
        if (s.crowned != null) {
          v.react = "crown";
          if (s.crowned) {
            v.fid = TURNED;
            v.dir = -god.dir;
          }
        }
        v.moving = true;
        break;
      case "seal":
        if (quiet) break;
        v.sealed = god.sealed || u >= SEAL_AT;
        v.press = 1 + 0.7 * (1 - clamp01((u - SEAL_AT) / PRESS));
        v.moving = u < SEAL_AT + PRESS;
        break;
      case "fail":
        if (quiet) break;
        v.dim = Math.max(god.dim, clamp01((u - DIM_AT) / DIM));
        if (god.ending === "fail") v.crack = Math.max(god.crack, clamp01((u - DIM_AT) / CRACK));
        v.moving = u < DIM_AT + DIM;
        break;
      case "unset":
        // Asked for less motion on the way: it is simply gone.
        if (quiet) {
          v.fig = v.name = 0;
          break;
        }
        v.fig = 1 - clamp01(u / UNSET);
        v.name = 1 - clamp01(u / NAME_OUT);
        v.tiles = { mode: s.how ?? "lift", pose: "stand", u, a: 1, dim: god.dim > 0 };
        v.moving = true;
        break;
      default:
    }
    if (v.y === 0) v.y = 0; // never -0
    return v;
  }

  // An amount from 0 to 1 as a custom property: none at 1, where the stylesheet's own figure stands.
  function amount(el: HTMLElement, name: string, k: number): void {
    if (k > 0 && k < 1) el.style.setProperty(name, k.toFixed(3));
    else el.style.removeProperty(name);
  }

  // One god's frame. Whether the next will draw it otherwise.
  function renderGod(god: God, now: number): boolean {
    const v = sample(god, now);
    god.vis = v;
    const el = god.el;
    const up = v.y ? `${Number(v.y.toFixed(2))}px` : "0";
    put(god, "tx", `translate3d(${v.x.toFixed(2)}px, ${up}, 0)`, (tx) => (el.style.transform = tx));
    put(god, "dir", v.dir < 0, (left) => el.classList.toggle("is-left", left));
    put(god, "pose", v.pose, (pose) => (el.dataset.pose = pose));
    put(god, "fig", v.fig, (k) => (god.fig.style.opacity = k === 1 ? "" : k.toFixed(3)));
    put(god, "sealed", v.sealed, (on) => el.classList.toggle("is-sealed", on));
    put(
      god,
      "press",
      v.press,
      (k) => (god.sealEl.style.transform = k === 1 ? "" : `scale(${k.toFixed(3)})`),
    );
    put(god, "speaking", god.ribbon !== null, (on) => el.classList.toggle("is-speaking", on));
    // At its work it can be startled: then it is a button with something to press.
    put(god, "startable", startOf(god.gid) !== undefined && atWork(god), (on) => {
      el.classList.toggle("is-startable", on);
      if (on) el.removeAttribute("aria-disabled");
      else el.setAttribute("aria-disabled", "true");
    });
    put(god, "dim", v.dim, (k) => {
      el.classList.toggle("is-dim", k > 0);
      amount(el, "--oly-dim", k);
    });
    put(god, "crack", v.crack, (k) => {
      el.classList.toggle("is-cracked", k > 0);
      amount(el, "--oly-crack", k);
    });
    const ribbon = god.ribbon;
    if (ribbon) put(god, "u", v.rib.toFixed(3), (u) => ribbon.style.setProperty("--oly-u", u));
    // Its fidget, its reaction or its start: the whole figure's transform, its
    // pose's second frame, the reaction or the start it shows, and its cut-out part.
    const f = v.fid;
    put(god, "fid", f.tx, (tx) => (god.posesEl.style.transform = tx));
    put(god, "frame", f.frame, (frame) => {
      if (frame) el.dataset.frame = frame;
      else delete el.dataset.frame;
    });
    put(god, "react", v.react, (how) => {
      if (how) el.dataset.react = how;
      else delete el.dataset.react;
    });
    put(god, "part", f.part && `${v.pose} ${f.ptx}`, (on) => {
      if (god.moved) god.moved.style.transform = "";
      god.moved = (on && god.parts.get(v.pose)) || null;
      if (god.moved) {
        god.moved.style.transform = f.ptx;
        el.dataset.part = f.part;
      } else delete el.dataset.part;
    });
    return v.moving;
  }

  // The names on the stylobate, under their gods, kept apart and inside the step.
  function renderNames(): void {
    const list: { god: God; c: number; w: number; a: number }[] = [];
    for (const god of gods.values()) {
      const v = god.vis;
      if (!out(god) || !v) continue;
      // At its place its name stays where its standing name is, as it faces there.
      const at = seated(god);
      const [a, b] = fpOf(god, at ? "stand" : v.pose);
      const middle = (at ? god.face : v.dir) > 0 ? (a + b) / 2 : AXIS - (a + b) / 2;
      list.push({ god, c: v.x + middle, w: god.labelW, a: v.name });
    }
    list.sort((p, q) => p.c - q.c);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1]!;
        const q = list[i]!;
        const min = (p.w + q.w) / 2 + 12;
        if (q.c - p.c < min) {
          const push = (min - (q.c - p.c)) / 2;
          p.c -= push;
          q.c += push;
        }
      }
      for (const n of list) n.c = clamp(n.c, n.w / 2 + 14, W - n.w / 2 - 14);
    }
    for (const n of list) {
      const label = n.god.label;
      put(
        n.god,
        "name",
        `translate3d(${(n.c - n.w / 2).toFixed(2)}px, 0, 0)`,
        (tx) => (label.style.transform = tx),
      );
      put(n.god, "nameA", n.a, (k) => (label.style.opacity = k === 1 ? "" : k.toFixed(3)));
    }
  }

  // ───────── the card ─────────
  // Whose card is up: the god hovered, else the one focused from the keyboard; nobody's if Esc hid it.
  function cardFor(): string | null {
    const key = hoverKey ?? (kbd ? focusKey : null);
    return key === dismissed ? null : key;
  }

  function hideCard(): void {
    onCard = false;
    if (!shown) return;
    shown = null;
    opts.onCard?.(null);
  }

  // Where it stands, by its god as last drawn: its left a little before the
  // god's head line, inside the lane; its foot over the highest the god
  // reaches at its work, over its standing top while it walks, or over the pose
  // it shows; its caret at the head line, on the card's straight edge. It is
  // down once its god begins to go: for all its tesserae's flight.
  function placeCard(): void {
    const key = cardFor();
    const god = key === null ? undefined : gods.get(key);
    const m = god && !god.landed ? medals.find((o) => o.god === god) : undefined;
    if (god && m) {
      // Over a medallion: the same card, its caret on the medallion, its foot
      // over the peg; one height while it hangs in its slot, and moving up with it.
      if (!inBar(m) || m.y === null || mode !== "open") return hideCard();
      const mid = medalX(m) + (POOL.w + 2 * POOL.rim) / 2;
      const at = clamp(mid - 30, 6, W - 6 - TIP_W);
      return putCard(
        god.key,
        at,
        CELL_Y + m.y - POOL.peg - TOP - CARD_AIR,
        clamp(mid - at, CARET_IN, TIP_W - CARET_IN),
      );
    }
    const kind = god?.seg?.kind;
    if (!god || !out(god) || mode !== "open" || kind === "unset") return hideCard();
    const v = god.vis;
    const head = (v?.x ?? god.x) + HEAD;
    const left = clamp(head - 30, 6, W - 6 - TIP_W);
    const top = seated(god)
      ? god.c.card // and while the one who flies comes down from it
      : kind === "walk" || kind === "glance"
        ? god.c.top.stand - god.c.move.lift
        : (god.c.top[v?.pose ?? god.pose] ?? god.c.top.stand) + (v?.y ?? 0);
    const foot = CELL_Y + top - CARD_AIR;
    putCard(god.key, left, foot, clamp(head - left, CARET_IN, TIP_W - CARET_IN));
  }

  function putCard(key: string, left: number, foot: number, caret: number): void {
    const was = shown;
    if (was?.key === key && was.left === left && was.foot === foot && was.caret === caret) return;
    shown = { key, left, foot, caret };
    if (card) {
      card.style.transform = `translate3d(${left.toFixed(2)}px, 0, 0)`;
      card.style.setProperty("--oly-ty", `${foot.toFixed(1)}px`);
      card.style.setProperty("--oly-caret", `${caret.toFixed(1)}px`);
    }
    if (was?.key !== key) opts.onCard?.(key);
  }

  // What the pointer and the keyboard have changed goes on the page at once:
  // it is no step of the run, and waits for none.
  function attend(): void {
    if (disposed) return;
    for (const god of gods.values()) {
      if (!out(god)) continue;
      const label = god.label;
      put(god, "focus", kbd && focusKey === god.key, (on) =>
        label.classList.toggle("is-focus", on),
      );
    }
    for (const m of medals) {
      const on = kbd && inBar(m) && document.activeElement === m.el;
      if (on === m.focus) continue;
      m.focus = on;
      m.el.classList.toggle("is-focus", on);
    }
    placeCard();
  }

  function stay(): void {
    if (grace !== null) wall.cancel(grace);
    grace = null;
  }

  // The pointer has left a god or the card: the card stays a moment, and while either is under it.
  function linger(): void {
    stay();
    grace = wall.defer(() => {
      grace = null;
      if (overKey === null && !onCard) hoverKey = null;
      attend();
    }, HOVER_GRACE);
  }

  const onCardEnter = (): void => {
    onCard = true;
    stay();
  };
  const onCardLeave = (): void => {
    onCard = false;
    linger();
  };
  card?.addEventListener("pointerenter", onCardEnter);
  card?.addEventListener("pointerleave", onCardLeave);

  // ───────── the keyboard: the gods and the medallions are one toolbar, its one tab stop on one of them ─────────
  // In floor order: the left pier's medallions top to bottom, the gods along
  // the lane, left to right, each where it was last drawn, then the right
  // pier's medallions top to bottom.
  const drawnX = (god: God): number => god.vis?.x ?? god.x;
  function items(): BarItem[] {
    const hung = (side: -1 | 1): BarItem[] =>
      medals
        .filter((m) => m.side === side && inBar(m))
        .sort((a, b) => a.slot - b.slot)
        .map((m) => ({ god: m.god, el: m.el, x: medalX(m) }));
    const floor = [...gods.values()]
      .filter(out)
      .sort((a, b) => drawnX(a) - drawnX(b))
      .map((g) => ({ god: g, el: g.el, x: drawnX(g) }));
    return [...hung(-1), ...floor, ...hung(1)];
  }
  const godAt = (node: EventTarget | null): God | undefined =>
    node instanceof Node ? [...gods.values()].find((g) => g.el.contains(node)) : undefined;
  const medalOf = (node: EventTarget | null): Medal | undefined =>
    node instanceof Node ? medals.find((m) => m.el.contains(node)) : undefined;

  function roveTo(el: HTMLElement): void {
    if (rove && rove !== el) rove.tabIndex = -1;
    rove = el;
    if (el.tabIndex !== 0) el.tabIndex = 0;
  }

  // The tab stop stays on one god; with none on the lane the toolbar is hidden, being empty.
  function roveFix(): void {
    const list = items();
    const first = list[0];
    if (!first) {
      rove = null;
      godsEl.setAttribute("aria-hidden", "true");
      return;
    }
    godsEl.removeAttribute("aria-hidden");
    roveTo(list.find((o) => o.el === rove)?.el ?? first.el);
  }

  // One with focus is going: focus goes to the nearest left in the toolbar, or
  // from the last to the composer. Focus anywhere else is left where it is.
  function refocus(el: HTMLElement, x: number): void {
    if (!el.contains(document.activeElement)) return;
    const near = items()
      .filter((o) => o.el !== el)
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    if (near) {
      roveTo(near.el);
      near.el.focus({ preventScroll: true });
    } else opts.away?.()?.focus({ preventScroll: true });
  }

  const onFocusIn = (e: FocusEvent): void => {
    const m = medalOf(e.target);
    const god = m?.god ?? godAt(e.target);
    if (!god) return;
    // Focus has moved: a card Esc hid may show again, unless the pointer is still on its god.
    if (dismissed !== god.key && dismissed !== overKey) dismissed = null;
    focusKey = god.key;
    roveTo(m?.el ?? god.el);
    attend();
  };
  const onFocusOut = (e: FocusEvent): void => {
    if (e.relatedTarget instanceof Node && godsEl.contains(e.relatedTarget)) return;
    focusKey = null;
    if (dismissed !== overKey) dismissed = null;
    attend();
  };
  const onToolbarKey = (e: KeyboardEvent): void => {
    const m = medalOf(e.target);
    const god = m?.god ?? godAt(e.target);
    if (!god || e.altKey || e.ctrlKey || e.metaKey) return;
    // The key is taken, so the page doesn't scroll. It startles the god, if it
    // can be: once, however long it is held.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.repeat) return;
      if (m) knock(m);
      else press(god);
      return;
    }
    const list = items();
    const at = m?.el ?? god.el;
    const i = list.findIndex((o) => o.el === at);
    const to = {
      ArrowLeft: list[Math.max(0, i - 1)],
      ArrowRight: list[Math.min(list.length - 1, i + 1)],
      Home: list[0],
      End: list[list.length - 1],
    }[e.key];
    if (!to) return;
    e.preventDefault();
    roveTo(to.el);
    to.el.focus({ preventScroll: true });
  };
  // From a key until the next press of a pointer the keyboard is in use, as
  // :focus-visible has it; only then does the card follow focus. Esc hides the
  // card that is up. One the pointer holds up lets the key go on to whatever
  // else it is for: with the caret in the text box it stops a run, and still
  // does. One shown for the keyboard uses it up, and stays hidden until focus
  // moves.
  const onKeyDown = (e: KeyboardEvent): void => {
    const up = shown?.key ?? null;
    kbd = true;
    if (e.key === "Escape" && up !== null) {
      if (hoverKey === up) {
        if (overKey === up)
          dismissed = up; // until the pointer leaves its god
        else hoverKey = null; // only the card, or the grace, held it up
        stay();
      } else {
        dismissed = up;
        e.preventDefault();
        e.stopPropagation();
      }
    }
    attend();
  };
  const onPointerDown = (): void => {
    if (!kbd) return;
    kbd = false;
    attend();
  };
  godsEl.addEventListener("focusin", onFocusIn);
  godsEl.addEventListener("focusout", onFocusOut);
  godsEl.addEventListener("keydown", onToolbarKey);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  roveFix();

  // ───────── the tesserae ─────────
  // A pose's stones, cut once from dice of its own.
  function stonesOf(god: God, pose: "speak" | "stand"): Tessera[] {
    const key = `${god.gid}:${pose}`;
    let set = stones.get(key);
    if (!set) stones.set(key, (set = cutTesserae(god.c.tiles[pose], rng(hash(key)), H)));
    return set;
  }

  function ivoriesOf(god: God): { lit: readonly string[]; dim: readonly string[] } {
    let pal = ivories.get(god.gid);
    if (!pal) {
      const lit = god.c.tiles.palette;
      ivories.set(god.gid, (pal = { lit, dim: lit.map(dimmed) }));
    }
    return pal;
  }

  // Every god's tesserae as its frame has them, on the one canvas behind the
  // gods. It is wiped before the first of a frame, and once more when the last
  // flight is over: then nothing is drawn until the next.
  function renderTesserae(): void {
    let ctx: CanvasRenderingContext2D | null = null;
    for (const god of gods.values()) {
      const T = out(god) ? god.vis?.tiles : null;
      if (!T) continue;
      ctx ??= wipe();
      if (!ctx) return;
      drawTesserae(ctx, stonesOf(god, T.pose), ivoriesOf(god)[T.dim ? "dim" : "lit"], {
        mode: T.mode,
        u: T.u,
        a: T.a,
        x: god.vis!.x,
        y: TOP + god.vis!.y,
        dir: god.vis!.dir,
        axis: AXIS,
      });
    }
    if (ctx) fxDrawn = true;
    else if (fxDrawn) {
      wipe();
      fxDrawn = false;
    }
  }

  // The canvas blank, at the lane's width and the screen's density as they are now.
  function wipe(): CanvasRenderingContext2D | null {
    if (!fx) return null;
    if (brush === undefined) brush = fx.getContext("2d") ?? null;
    if (!brush) return null;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.round(W * dpr);
    const h = Math.round(H * dpr);
    if (fx.width !== w) fx.width = w;
    if (fx.height !== h) fx.height = h;
    brush.setTransform(dpr, 0, 0, dpr, 0, 0);
    brush.clearRect(0, 0, W, H);
    return brush;
  }

  // A frame: a start for each god pressed since the last; then the lane, its
  // floor, every god and its name from the time alone,
  // the tesserae of those being set or unset, then the card. Moving while the
  // lane, its floor or a god will be drawn otherwise next frame; if none will,
  // the moment the first god's next gesture begins, so the clock may sleep
  // until then. The card never keeps the clock awake.
  sim.view((now) => {
    if (disposed) return false;
    // What the reader pressed since the last frame starts now, if it may.
    if (pressed.size) {
      for (const god of pressed) poke(god, now);
      pressed.clear();
    }
    if (knocked.size) {
      for (const m of knocked) rock(m, now);
      knocked.clear();
    }
    let moving = renderLane(now);
    moving = renderFloor(now) || moving;
    let wake = Infinity;
    for (const god of gods.values()) {
      if (!out(god)) continue;
      moving = renderGod(god, now) || moving;
      wake = Math.min(wake, god.vis!.wake);
    }
    renderTesserae();
    renderNames();
    moving = renderPiers(now) || moving;
    moving = renderMedals(now) || moving;
    attend();
    return moving || (wake < Infinity ? wake : false);
  });

  function reconcile(agents: readonly LaneAgent[]): void {
    const t = sim.now();
    latest = agents;
    const seen = new Set<string>();
    for (const a of agents) {
      if (seen.has(a.key)) continue;
      seen.add(a.key);
      if (a.look !== "run") ended.set(a.key, a.tools);
      const god = gods.get(a.key);
      if (!god) {
        if (a.look === "run") summon(a, t); // else it finished before the floor saw it
        continue;
      }
      god.agent = a;
      if (a.look !== "run") {
        const was = god.ending;
        finish(god, a.look, t);
        // Its neighbours may notice: a stop, as a failure.
        if (!was && out(god)) notice(god, a.look === "done" ? "done" : "fail", t);
      } else if (!god.ending) heed(god, t);
    }
    for (const god of [...gods.values()]) if (!seen.has(god.key)) remove(god, t);
    for (const key of [...ended.keys()]) if (!seen.has(key)) ended.delete(key);
  }

  let synced = "";

  return {
    sync(agents) {
      if (disposed) return;
      const now = agents
        .map((a) => `${a.key} ${a.god} ${a.look} ${a.family} ${a.tools}`)
        .join("\n");
      if (now === synced) return;
      synced = now;
      const records = [...agents];
      sim.soon(() => reconcile(records));
    },
    resize() {
      if (disposed) return;
      sim.soon(() => {
        if (mode === "shut" || !measureLane()) return;
        // Everyone keeps its order and its facing, and takes the nearest place
        // there is room for: whoever is at its work walks there.
        const t = sim.now();
        const all = byseat().map((g) => ({ g, x: clamp(g.seat, seatMin(g), seatMax(g)) }));
        const seats = spread(all, new Set()) ?? all.map((o) => o.x);
        all.forEach((o, i) => reseat(o.g, seats[i]!, t));
      });
    },
    remeasure() {
      if (disposed) return;
      sim.soon(() => {
        for (const god of gods.values()) {
          if (!god.landed) continue;
          god.labelW = measure(god.label);
          god.out.name = null;
        }
      });
    },
    peek: () => {
      const now = sim.now();
      const laidNow = floorAt(now);
      return {
        open: mode !== "shut",
        lane: { mode, height: laneAt(now) },
        floor: laidNow && { scene: laidNow.scene, phase: laidNow.phase },
        width: W,
        queue: queue.map((g) => g.key),
        waiting: pool.map((g) => g.key),
        piers: { width: pierAt(now), wide: now >= wideAt(), edges: [edgeL, edgeR] },
        medallions: medals.map((m) => ({
          key: m.god.key,
          side: m.side,
          slot: m.slot,
          y: slideY(m, now),
          shown: medalShown(m, now),
          going: m.downAt !== null,
        })),
        gods: [...gods.values()].filter(out).map((g) => {
          const [a, b] = envOf(g);
          const v = sample(g, now);
          return {
            key: g.key,
            god: g.gid,
            x: v.x,
            figure: span(g, v.x, v.pose, v.dir),
            place: g.seat == null ? null : ([g.seat + a, g.seat + b] as const),
            face: g.face,
            dir: v.dir,
            pose: v.pose,
            want: g.want,
            lift: v.y ? -v.y : 0,
            fidget: v.fid === STILL ? null : v.fid,
            react:
              v.react && v.react !== "start" && g.react ? { how: v.react, of: g.react.of } : null,
            start: v.react === "start" && g.start ? { small: g.start.small } : null,
            shown: v.fig,
            tesserae: v.tiles && { mode: v.tiles.mode, dim: v.tiles.dim },
            unrolled: g.ribbon ? v.rib : null,
            press: v.press,
            dim: v.dim,
            step: g.seg?.kind ?? "",
            line: g.ribbon ? g.said : null,
            ribbon: g.ribbon && g.rib ? ([g.rib.x0, g.rib.x1] as const) : null,
            ending: g.ending,
          };
        }),
        card: shown,
      };
    },
    dispose() {
      if (disposed) return;
      const focused = godsEl.contains(document.activeElement);
      disposed = true;
      for (const god of gods.values()) {
        god.gone = true;
        sim.cancel(god.seg?.timer);
        sim.cancel(god.seg?.nudge);
        uncue(god);
        god.el.remove();
        god.label.remove();
      }
      gods.clear();
      pressed.clear();
      if (fxDrawn) wipe();
      fxDrawn = false;
      stones.clear();
      scene = null;
      if (bedDrawn !== "") wipeBed(density(), 0);
      bedDrawn = "";
      shownFloor = null;
      queue.length = 0;
      pool.length = 0;
      clearMedals();
      narrow();
      for (const e of laneTimers) sim.cancel(e);
      laneTimers.clear();
      sim.cancel(landTimer);
      landTimer = null;
      preload.length = 0;
      mode = "shut";
      reopen = false;
      lane.classList.add("is-shut");
      setHeight(null);
      // The card and the keyboard go with it; focus on a god goes to the composer.
      stay();
      overKey = hoverKey = focusKey = dismissed = null;
      kbd = false;
      hideCard();
      roveFix();
      if (focused) opts.away?.()?.focus({ preventScroll: true });
      card?.removeEventListener("pointerenter", onCardEnter);
      card?.removeEventListener("pointerleave", onCardLeave);
      godsEl.removeEventListener("focusin", onFocusIn);
      godsEl.removeEventListener("focusout", onFocusOut);
      godsEl.removeEventListener("keydown", onToolbarKey);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    },
  };
}
