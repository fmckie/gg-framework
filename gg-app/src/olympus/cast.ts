// The cast as the lane reads it: each god's measurements, from the mockup
// (cast.json, written by scripts/olympus-cast.mjs), and its pictures.

import data from "./cast.json";
import type { GodId } from "./gods";
import argusSpeak from "./poses/argus-speak.webp";
import argusStand from "./poses/argus-stand.webp";
import athenaSpeak from "./poses/athena-speak.webp";
import athenaStand from "./poses/athena-stand.webp";
import hephaestusSpeak from "./poses/hephaestus-speak.webp";
import hephaestusStand from "./poses/hephaestus-stand.webp";
import hermesSpeak from "./poses/hermes-speak.webp";
import hermesStand from "./poses/hermes-stand.webp";
import herodotusSpeak from "./poses/herodotus-speak.webp";
import herodotusStand from "./poses/herodotus-stand.webp";
import nikeSpeak from "./poses/nike-speak.webp";
import nikeStand from "./poses/nike-stand.webp";
import themisSpeak from "./poses/themis-speak.webp";
import themisStand from "./poses/themis-stand.webp";

/** The poses the lane draws so far. */
export type Pose = "stand" | "speak";
export const POSES: readonly Pose[] = ["speak", "stand"];

/** A piece of a small drawing: an SVG element, its attributes and what is in it. */
export interface SvgNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children?: readonly SvgNode[];
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
  readonly fp: Readonly<Record<Pose, readonly [number, number]>>;
  /** Where the seal is pressed on its rolled scroll. */
  readonly seal: readonly [number, number];
  /** The crack across its standing figure. */
  readonly fissure: readonly SvgNode[];
}

export interface Cast {
  readonly source: string;
  readonly cell: { readonly w: number; readonly h: number; readonly head: number };
  readonly seal: { readonly viewBox: string; readonly nodes: readonly SvgNode[] };
  readonly gods: Readonly<Record<GodId, CastGod>>;
}

// JSON has no tuples: its number arrays are checked by cast.test.ts instead.
export const CAST = data as unknown as Cast;

/** Each god's pictures, 146×200, drawn at 73×100. */
export const POSE_URLS: Readonly<Record<GodId, Readonly<Record<Pose, string>>>> = {
  athena: { stand: athenaStand, speak: athenaSpeak },
  herodotus: { stand: herodotusStand, speak: herodotusSpeak },
  hermes: { stand: hermesStand, speak: hermesSpeak },
  hephaestus: { stand: hephaestusStand, speak: hephaestusSpeak },
  argus: { stand: argusStand, speak: argusSpeak },
  themis: { stand: themisStand, speak: themisSpeak },
  nike: { stand: nikeStand, speak: nikeSpeak },
};
