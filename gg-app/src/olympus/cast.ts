// The cast as the lane reads it: each god's measurements, from the mockup
// (cast.json, written by scripts/olympus-cast.mjs), and its pictures.

import { poseUrl } from "./art";
import data from "./cast.json";
import type { GodId } from "./gods";
import type { ToolFamily } from "./tool-family";

/** The poses every god has: standing, holding out a line, and in mid stride as it walks. */
export type Stance = "stand" | "speak" | "stride";
export const POSES: readonly Stance[] = ["speak", "stand", "stride"];
/** The poses a god acts a tool in. No god has them all; Themis thinks with her scales, tipped either way. */
export type Skill = "look" | "web" | "make" | "run" | "think" | "think-l" | "think-r";
export type Pose = Stance | Skill;

/** A piece of a small drawing: an SVG element, its attributes and what is in it. */
export interface SvgNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children?: readonly SvgNode[];
}

/**
 * A course of a god's tesserae: its top, its bottom and its left in tenths of
 * a px, a stone's width in hundredths, then a stone a character: its ivory in
 * the palette, or "-" where the figure isn't.
 */
export type Course = readonly [number, number, number, number, string];

/** How a god acts one family of tool. */
export interface Act {
  readonly pose: Skill;
  /** Themis's scales: the pose for each way a finding can go. */
  readonly verdict?: { readonly confirmed: Skill; readonly dropped: Skill };
}

/**
 * A state of a gesture: the figure, or its cut-out part, shifted (px) and
 * turned (degrees) about the move's pivot; the figure about-faced, or in its
 * pose's second frame; the part gone; the one who flies at a height.
 */
export interface FidgetState {
  readonly dx?: number;
  readonly dy?: number;
  readonly rot?: number;
  readonly turn?: boolean;
  readonly frame?: "b";
  readonly lift?: number;
  readonly gone?: boolean;
}

/** A gesture: a state from each of its beats on, counted from where it starts. */
export interface FidgetMove {
  readonly keys: readonly (readonly [beat: number, state: FidgetState])[];
  /** How long the figure eases into each state, ms; none, and each is a cut. */
  readonly ease: number;
  /** Idling, how likely it is dealt, against the pose's other moves and its rest. */
  readonly w: number;
  /** The cut-out part it moves, if not the whole figure. */
  readonly part: string | null;
  /** What a turn is about: in the cell, or for a part in its pose's own picture. */
  readonly pivot: readonly [number, number] | null;
  /** The beat it is over by. */
  readonly end: number;
}

/**
 * What a pose does while it is held, in the god's own beats from the cut that
 * showed it: a move played once on the cut; or a rhythm, its one move coming
 * round every bar; or idling, each bar dealt one of its moves or none.
 */
export interface Fidget {
  readonly bar: number;
  readonly idle: boolean;
  readonly rest: number;
  readonly cut: FidgetMove | null;
  readonly moves: readonly FidgetMove[];
}

/** What a god may notice: another arriving, finishing, or failing. */
export type Noticed = "arrive" | "done" | "fail";

/**
 * How a pose notices: the floor under its front, which a glance leans about,
 * and under its heel, for a glance back, each in the cell; how far it leans,
 * in degrees; and whether it may turn to face what is behind it.
 */
export interface NoticeOf {
  readonly front: readonly [number, number];
  readonly back: readonly [number, number];
  readonly lean: number;
  readonly turn: boolean;
}

/**
 * The crown, raised toward a god that has finished: how late it may begin,
 * ms, for how many of her beats it is held, and where its picture sits in the
 * cell: left, width.
 */
export interface Crown {
  readonly late: number;
  readonly beats: number;
  readonly at: readonly [number, number];
}

/**
 * A god's start, what it does when the reader presses it at its work: how far
 * it hops, px, and for how many of its beats it is held; where its picture
 * sits in the cell: left, width; its top there; and its outline, in bands 2px
 * high: top, from, to. It is no part of the envelope: the lane keeps lines
 * off it.
 */
export interface StartOf {
  readonly hop: number;
  readonly beats: number;
  readonly at: readonly [number, number];
  readonly top: number;
  readonly ol: readonly (readonly [number, number, number])[];
}

/** A pose's cut-out part: polygons in the pose's own picture, px. */
export interface Part {
  readonly name: string;
  /** The part: the picture again, clipped to this. */
  readonly cut: readonly (readonly [number, number])[];
  /** The hole it leaves in the pose while it moves. */
  readonly hole: readonly (readonly [number, number])[];
}

/** One god, measured in its 73×100 cell, facing right. */
export interface CastGod {
  readonly name: string;
  /** All the floor it can cover at its place, in any pose: from, to. */
  readonly env: readonly [number, number];
  /** That envelope's outline, in bands 2px high: top, from, to. */
  readonly envol: readonly (readonly [number, number, number])[];
  /** The fingers of its open hand, where a ribbon starts. */
  readonly hand: readonly [number, number];
  /** Each pose's figure along the floor: from, to. */
  readonly fp: Readonly<Record<Stance, readonly [number, number]>> &
    Readonly<Partial<Record<Skill, readonly [number, number]>>>;
  /** Its beat, ms: at its place a cut from one pose to the next falls on it, and walking, its stride does. */
  readonly step: number;
  /** How it walks. */
  readonly move: {
    /** Its pace, px a second. */
    readonly speed: number;
    /** How far it dips on each footfall. */
    readonly bob: number;
    /** How far off the floor it is held as it goes. */
    readonly lift: number;
    /** How likely it is to stop on a long walk and look round: 0 to 1. */
    readonly pause: number;
    /** How it sets off and pulls up. */
    readonly ease: "linear" | "ease-in-out" | "ease-out";
  };
  /** The pose it acts each family of tool in; a family it has none for, it thinks. */
  readonly acts: Readonly<Partial<Record<ToolFamily, Act>>> & { readonly think: Act };
  /** Where each skill pose's picture sits in the cell: left, width. */
  readonly at: Readonly<Partial<Record<Skill, readonly [number, number]>>>;
  /** How far off the floor a pose is held. */
  readonly lift: Readonly<Partial<Record<Skill, number>>>;
  /** The poses in two frames: the second, b, is cut to for a move that is a limb's. */
  readonly frames: Readonly<Partial<Record<Skill, readonly "b"[]>>>;
  /** The poses with a cut-out part, which hangs or flies free of the body. */
  readonly parts: Readonly<Partial<Record<Skill, Part>>>;
  /** What each pose does while it is held; a pose with nothing is a still. */
  readonly fid: Readonly<Partial<Record<Skill, Fidget>>>;
  /** How each of its skill poses notices. */
  readonly nt: Readonly<Partial<Record<Skill, NoticeOf>>>;
  /** How likely it is to notice each kind of event, by its nature: 0 to 1. */
  readonly chance: Readonly<Record<Noticed, number>>;
  /** Its reaction to a finish, if it has one of its own: Nike's crown. */
  readonly rx: { readonly crown?: Crown };
  /** Its start, when the reader presses it at its work. */
  readonly st: StartOf;
  /** Its medallion: how far it tilts as it rocks on its peg, degrees; and what it is set from. */
  readonly medal: {
    readonly tilt: number;
    /** Its tesserae: a palette of its own, and its courses from the foot up. */
    readonly tiles: { readonly palette: readonly string[]; readonly rows: readonly Course[] };
  };
  /** Each pose's top in the cell. */
  readonly top: Readonly<Record<Stance, number>> & Readonly<Partial<Record<Skill, number>>>;
  /** The height its card holds while it works: over the highest it reaches at its place. */
  readonly card: number;
  /** Where the seal is pressed on its rolled scroll. */
  readonly seal: readonly [number, number];
  /** The crack across its standing figure. */
  readonly fissure: readonly SvgNode[];
  /**
   * Its tesserae: twelve of its own ivories, and the pose it is set from and
   * the pose it goes back to, each cut in courses from the feet up.
   */
  readonly tiles: { readonly palette: readonly string[] } & Readonly<
    Record<"speak" | "stand", readonly Course[]>
  >;
}

export interface Cast {
  readonly source: string;
  readonly cell: { readonly w: number; readonly h: number; readonly head: number };
  /** The crack across a failed medallion, in its box. */
  readonly crack: { readonly viewBox: string; readonly nodes: readonly SvgNode[] };
  readonly seal: { readonly viewBox: string; readonly nodes: readonly SvgNode[] };
  /**
   * How the gods notice each other: how far along the floor, px; how long a
   * god rests before it notices again, and how late a notice may begin, ms;
   * how long a lean eases in and out, and how long each notice is held, in the
   * god's own beats.
   */
  readonly notice: {
    readonly reach: number;
    readonly rest: number;
    readonly late: number;
    readonly ease: number;
    readonly beats: Readonly<Record<Noticed, number>>;
  };
  /**
   * How the gods start when pressed: for how long a hop eases back to the
   * floor, in the god's own beats; within how long of its last start, ms, a
   * god starts smaller, with no hop, and for how many beats then; and how far
   * off a start a line is kept, px.
   */
  readonly startle: {
    readonly down: number;
    readonly again: number;
    readonly againBeats: number;
    readonly line: number;
  };
  /**
   * The pool's medallions: a cameo's width and height, its rim and its peg,
   * px; how many hang on a side and how far apart; where the first hangs from
   * the lane's corner, how wide the pier it hangs on is, how wide an anta is
   * before it widens to one, and where the floor's edge is inside a pier; and
   * for how long one is set, shows through, is taken down, and moves up a
   * slot, and the antae widen, ms; and as it rocks on its peg, how far back
   * through rest it swings and how much smaller a second rock soon after is,
   * as parts of its tilt.
   */
  readonly pool: {
    readonly w: number;
    readonly h: number;
    readonly rim: number;
    readonly peg: number;
    readonly slots: number;
    readonly pitch: number;
    readonly x: number;
    readonly y: number;
    readonly pier: number;
    readonly anta: number;
    readonly edge: number;
    readonly set: number;
    readonly reveal: number;
    readonly scatter: number;
    readonly slide: number;
    readonly widen: number;
    /** A failed one: how long it dims, and how long it hangs cracked before it falls, ms. */
    readonly crack: number;
    readonly hold: number;
    readonly back: number;
    readonly again: number;
  };
  readonly gods: Readonly<Record<GodId, CastGod>>;
}

// JSON has no tuples: its number arrays are checked by cast.test.ts instead.
export const CAST = data as unknown as Cast;

/** One god's pictures: its stances and its stride, and the skill poses it has. */
export type Pictures = Readonly<Record<Stance, string>> & Readonly<Partial<Record<Skill, string>>>;

/** The skill poses each god has a picture of. */
const SKILLS: Readonly<Record<GodId, readonly Skill[]>> = {
  athena: ["look", "think"],
  herodotus: ["look", "web", "think"],
  hermes: ["look", "make", "run", "think"],
  hephaestus: ["look", "make", "run", "think"],
  argus: ["look", "web", "run", "think"],
  themis: ["look", "web", "run", "think-r", "think-l"],
  nike: ["look", "make", "run", "think"],
};
const IDS = Object.keys(SKILLS) as GodId[];

/** A stance's picture is the whole cell. */
const WHOLE = [0, CAST.cell.w] as const;

/** A picture by name, placed in the cell, left and width: twice that size, its figure's head on the head line. */
function placed(name: string, [left, width]: readonly [number, number]): string {
  return poseUrl(name, 2 * width, 2 * (CAST.cell.head - left));
}

function picturesOf(id: GodId): Pictures {
  const at = CAST.gods[id].at;
  const pictures: Partial<Record<Pose, string>> = {};
  for (const pose of ["stand", "speak", "stride"] as const)
    pictures[pose] = placed(`${id}-${pose}`, WHOLE);
  for (const pose of SKILLS[id]) pictures[pose] = placed(`${id}-${pose}`, at[pose]!);
  return pictures as Pictures;
}

/** Each of the gods, with what `of` makes of it. */
function each<T>(of: (id: GodId) => T): Record<GodId, T> {
  return Object.fromEntries(IDS.map((id) => [id, of(id)])) as Record<GodId, T>;
}

/** Each god's pictures, at twice the size they are drawn: 200 high, a stance 146 wide. */
export const POSE_URLS: Readonly<Record<GodId, Pictures>> = each(picturesOf);

/** A god's second frames, by pose: each the size of its pose's first, and where it is. */
export type Frames = Readonly<Partial<Record<Skill, string>>>;

function frame(id: GodId, pose: Skill): Frames {
  return { [pose]: placed(`${id}-${pose}-b`, CAST.gods[id].at[pose]!) };
}

/** The poses in two frames: a stride, a hammer's blow, a wingbeat. */
export const FRAME_URLS: Readonly<Partial<Record<GodId, Frames>>> = {
  hermes: frame("hermes", "run"),
  hephaestus: frame("hephaestus", "make"),
  nike: frame("nike", "look"),
};

/** The crown's picture, for the one who gives it: 200 high, as a skill pose's is. */
export const CROWN_URLS: Readonly<Partial<Record<GodId, string>>> = {
  nike: placed("nike-crown", CAST.gods.nike.rx.crown!.at),
};

/** Each god's start, shown in place of its pose when the reader presses it: 200 high, as a skill pose's is. */
export const START_URLS: Readonly<Partial<Record<GodId, string>>> = each((id) =>
  placed(`${id}-start`, CAST.gods[id].st.at),
);
