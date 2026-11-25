// The cast as the lane reads it: each god's measurements, from the mockup
// (cast.json, written by scripts/olympus-cast.mjs), and its pictures.

import data from "./cast.json";
import type { GodId } from "./gods";
import argusLook from "./poses/argus-look.webp";
import argusRun from "./poses/argus-run.webp";
import argusSpeak from "./poses/argus-speak.webp";
import argusStand from "./poses/argus-stand.webp";
import argusStride from "./poses/argus-stride.webp";
import argusThink from "./poses/argus-think.webp";
import argusWeb from "./poses/argus-web.webp";
import athenaLook from "./poses/athena-look.webp";
import athenaSpeak from "./poses/athena-speak.webp";
import athenaStand from "./poses/athena-stand.webp";
import athenaStride from "./poses/athena-stride.webp";
import athenaThink from "./poses/athena-think.webp";
import hephaestusLook from "./poses/hephaestus-look.webp";
import hephaestusMake from "./poses/hephaestus-make.webp";
import hephaestusRun from "./poses/hephaestus-run.webp";
import hephaestusSpeak from "./poses/hephaestus-speak.webp";
import hephaestusStand from "./poses/hephaestus-stand.webp";
import hephaestusStride from "./poses/hephaestus-stride.webp";
import hephaestusThink from "./poses/hephaestus-think.webp";
import hermesLook from "./poses/hermes-look.webp";
import hermesMake from "./poses/hermes-make.webp";
import hermesRun from "./poses/hermes-run.webp";
import hermesSpeak from "./poses/hermes-speak.webp";
import hermesStand from "./poses/hermes-stand.webp";
import hermesStride from "./poses/hermes-stride.webp";
import hermesThink from "./poses/hermes-think.webp";
import herodotusLook from "./poses/herodotus-look.webp";
import herodotusSpeak from "./poses/herodotus-speak.webp";
import herodotusStand from "./poses/herodotus-stand.webp";
import herodotusStride from "./poses/herodotus-stride.webp";
import herodotusThink from "./poses/herodotus-think.webp";
import herodotusWeb from "./poses/herodotus-web.webp";
import nikeLook from "./poses/nike-look.webp";
import nikeMake from "./poses/nike-make.webp";
import nikeRun from "./poses/nike-run.webp";
import nikeSpeak from "./poses/nike-speak.webp";
import nikeStand from "./poses/nike-stand.webp";
import nikeStride from "./poses/nike-stride.webp";
import nikeThink from "./poses/nike-think.webp";
import themisLook from "./poses/themis-look.webp";
import themisRun from "./poses/themis-run.webp";
import themisSpeak from "./poses/themis-speak.webp";
import themisStand from "./poses/themis-stand.webp";
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
