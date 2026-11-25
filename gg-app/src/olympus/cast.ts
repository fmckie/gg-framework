// The cast as the lane reads it: each god's measurements, from the mockup
// (cast.json, written by scripts/olympus-cast.mjs), and its pictures.

import data from "./cast.json";
import type { GodId } from "./gods";
import argusLook from "./poses/argus-look.webp";
import argusRun from "./poses/argus-run.webp";
import argusSpeak from "./poses/argus-speak.webp";
import argusStand from "./poses/argus-stand.webp";
import argusStart from "./poses/argus-start.webp";
import argusStride from "./poses/argus-stride.webp";
import argusThink from "./poses/argus-think.webp";
import argusWeb from "./poses/argus-web.webp";
import athenaLook from "./poses/athena-look.webp";
import athenaSpeak from "./poses/athena-speak.webp";
import athenaStand from "./poses/athena-stand.webp";
import athenaStart from "./poses/athena-start.webp";
import athenaStride from "./poses/athena-stride.webp";
import athenaThink from "./poses/athena-think.webp";
import hephaestusLook from "./poses/hephaestus-look.webp";
import hephaestusMake from "./poses/hephaestus-make.webp";
import hephaestusMakeB from "./poses/hephaestus-make-b.webp";
import hephaestusRun from "./poses/hephaestus-run.webp";
import hephaestusSpeak from "./poses/hephaestus-speak.webp";
import hephaestusStand from "./poses/hephaestus-stand.webp";
import hephaestusStart from "./poses/hephaestus-start.webp";
import hephaestusStride from "./poses/hephaestus-stride.webp";
import hephaestusThink from "./poses/hephaestus-think.webp";
import hermesLook from "./poses/hermes-look.webp";
import hermesMake from "./poses/hermes-make.webp";
import hermesRun from "./poses/hermes-run.webp";
import hermesRunB from "./poses/hermes-run-b.webp";
import hermesSpeak from "./poses/hermes-speak.webp";
import hermesStand from "./poses/hermes-stand.webp";
import hermesStart from "./poses/hermes-start.webp";
import hermesStride from "./poses/hermes-stride.webp";
import hermesThink from "./poses/hermes-think.webp";
import herodotusLook from "./poses/herodotus-look.webp";
import herodotusSpeak from "./poses/herodotus-speak.webp";
import herodotusStand from "./poses/herodotus-stand.webp";
import herodotusStart from "./poses/herodotus-start.webp";
import herodotusStride from "./poses/herodotus-stride.webp";
import herodotusThink from "./poses/herodotus-think.webp";
import herodotusWeb from "./poses/herodotus-web.webp";
import nikeCrown from "./poses/nike-crown.webp";
import nikeLook from "./poses/nike-look.webp";
import nikeLookB from "./poses/nike-look-b.webp";
import nikeMake from "./poses/nike-make.webp";
import nikeRun from "./poses/nike-run.webp";
import nikeSpeak from "./poses/nike-speak.webp";
import nikeStand from "./poses/nike-stand.webp";
import nikeStart from "./poses/nike-start.webp";
import nikeStride from "./poses/nike-stride.webp";
import nikeThink from "./poses/nike-think.webp";
import themisLook from "./poses/themis-look.webp";
import themisRun from "./poses/themis-run.webp";
import themisSpeak from "./poses/themis-speak.webp";
import themisStand from "./poses/themis-stand.webp";
import themisStart from "./poses/themis-start.webp";
import themisStride from "./poses/themis-stride.webp";
import themisThinkL from "./poses/themis-think-l.webp";
import themisThinkR from "./poses/themis-think-r.webp";
import themisWeb from "./poses/themis-web.webp";
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
   * the lane's corner, and how wide the pier it hangs on is; and for how long
   * one is set, shows through, is taken down, and moves up a slot, ms.
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
    readonly set: number;
    readonly reveal: number;
    readonly scatter: number;
    readonly slide: number;
  };
  readonly gods: Readonly<Record<GodId, CastGod>>;
}

// JSON has no tuples: its number arrays are checked by cast.test.ts instead.
export const CAST = data as unknown as Cast;

/** One god's pictures: its stances and its stride, and the skill poses it has. */
export type Pictures = Readonly<Record<Stance, string>> & Readonly<Partial<Record<Skill, string>>>;

/** Each god's pictures, at twice the size they are drawn: 200 high, a stance 146 wide. */
export const POSE_URLS: Readonly<Record<GodId, Pictures>> = {
  athena: {
    stand: athenaStand,
    speak: athenaSpeak,
    stride: athenaStride,
    look: athenaLook,
    think: athenaThink,
  },
  herodotus: {
    stand: herodotusStand,
    speak: herodotusSpeak,
    stride: herodotusStride,
    look: herodotusLook,
    web: herodotusWeb,
    think: herodotusThink,
  },
  hermes: {
    stand: hermesStand,
    speak: hermesSpeak,
    stride: hermesStride,
    look: hermesLook,
    make: hermesMake,
    run: hermesRun,
    think: hermesThink,
  },
  hephaestus: {
    stand: hephaestusStand,
    speak: hephaestusSpeak,
    stride: hephaestusStride,
    look: hephaestusLook,
    make: hephaestusMake,
    run: hephaestusRun,
    think: hephaestusThink,
  },
  argus: {
    stand: argusStand,
    speak: argusSpeak,
    stride: argusStride,
    look: argusLook,
    web: argusWeb,
    run: argusRun,
    think: argusThink,
  },
  themis: {
    stand: themisStand,
    speak: themisSpeak,
    stride: themisStride,
    look: themisLook,
    web: themisWeb,
    run: themisRun,
    "think-r": themisThinkR,
    "think-l": themisThinkL,
  },
  nike: {
    stand: nikeStand,
    speak: nikeSpeak,
    stride: nikeStride,
    look: nikeLook,
    make: nikeMake,
    run: nikeRun,
    think: nikeThink,
  },
};

/** A god's second frames, by pose: each the size of its pose's first, and where it is. */
export type Frames = Readonly<Partial<Record<Skill, string>>>;

/** The poses in two frames: a stride, a hammer's blow, a wingbeat. */
export const FRAME_URLS: Readonly<Partial<Record<GodId, Frames>>> = {
  hermes: { run: hermesRunB },
  hephaestus: { make: hephaestusMakeB },
  nike: { look: nikeLookB },
};

/** The crown's picture, for the one who gives it: 200 high, as a skill pose's is. */
export const CROWN_URLS: Readonly<Partial<Record<GodId, string>>> = { nike: nikeCrown };

/** Each god's start, shown in place of its pose when the reader presses it: 200 high, as a skill pose's is. */
export const START_URLS: Readonly<Partial<Record<GodId, string>>> = {
  athena: athenaStart,
  herodotus: herodotusStart,
  hermes: hermesStart,
  hephaestus: hephaestusStart,
  argus: argusStart,
  themis: themisStart,
  nike: nikeStart,
};
