// An agent's look: a body shape, a face and a colour. Kleio's own drawings,
// in the spirit of glossy blob characters (soft gradient body, one highlight,
// dark glossy eyes) — not copied artwork. The host stores `shape` and `face`
// on each agent; hosts from before looks existed send neither, so the
// desktop derives the same default the host would from the agent's id.

import type { BlobColor } from "./kleioApi";

export const BLOB_SHAPES = [
  "orb",
  "mochi",
  "drop",
  "puff",
  "pill",
  "cube",
  "ghost",
  "star",
] as const;
export type BlobShape = (typeof BLOB_SHAPES)[number];

export const BLOB_FACES = [
  "calm",
  "happy",
  "curious",
  "sleepy",
  "wink",
  "focused",
  "surprised",
  "cheeky",
] as const;
export type BlobFaceKind = (typeof BLOB_FACES)[number];

export interface BlobLook {
  shape: BlobShape;
  face: BlobFaceKind;
  color: BlobColor;
}

export const SHAPE_LABEL: Record<BlobShape, string> = {
  orb: "Orb",
  mochi: "Mochi",
  drop: "Drop",
  puff: "Puff",
  pill: "Pill",
  cube: "Cube",
  ghost: "Ghost",
  star: "Star",
};

export const FACE_LABEL: Record<BlobFaceKind, string> = {
  calm: "Calm",
  happy: "Happy",
  curious: "Curious",
  sleepy: "Sleepy",
  wink: "Wink",
  focused: "Focused",
  surprised: "Surprised",
  cheeky: "Cheeky",
};

/** Each colour as [highlight, base, shade] for the body's gradient. */
export const BLOB_TONES: Record<BlobColor, readonly [string, string, string]> = {
  sky: ["#c4e6ff", "#5fb3f2", "#2c7fd0"],
  mint: ["#c9f7e4", "#5fd6a8", "#23a077"],
  peach: ["#ffe0c8", "#f6a46f", "#d9703a"],
  lilac: ["#e7dbff", "#ad8cf0", "#7a55cf"],
  lemon: ["#fff4bf", "#f5d457", "#d4a51c"],
  rose: ["#ffd6e2", "#f088a8", "#cf4f7a"],
  coral: ["#ffd0c7", "#f57f6c", "#d24a3a"],
  amber: ["#ffe2b0", "#f5ae3d", "#cf7c12"],
  teal: ["#bff0ee", "#3fc0bb", "#178c8a"],
  indigo: ["#d3d6ff", "#7b83ee", "#4a4fc4"],
  plum: ["#f1cdf0", "#c070c6", "#8c3c96"],
  slate: ["#dfe5ee", "#8e9bb0", "#5c6a80"],
};

export const BLOB_COLOR_LABEL: Record<BlobColor, string> = {
  sky: "Sky",
  mint: "Mint",
  peach: "Peach",
  lilac: "Lilac",
  lemon: "Lemon",
  rose: "Rose",
  coral: "Coral",
  amber: "Amber",
  teal: "Teal",
  indigo: "Indigo",
  plum: "Plum",
  slate: "Slate",
};

function isShape(v: unknown): v is BlobShape {
  return typeof v === "string" && (BLOB_SHAPES as readonly string[]).includes(v);
}

function isFace(v: unknown): v is BlobFaceKind {
  return typeof v === "string" && (BLOB_FACES as readonly string[]).includes(v);
}

/** FNV-1a over the id's UTF-16 code units. The host uses this exact hash. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The look a host gives an agent that never chose one. */
export function defaultLook(id: string): { shape: BlobShape; face: BlobFaceKind } {
  const h = hashId(id);
  return {
    shape: BLOB_SHAPES[h % BLOB_SHAPES.length] ?? "orb",
    face: BLOB_FACES[Math.floor(h / BLOB_SHAPES.length) % BLOB_FACES.length] ?? "calm",
  };
}

/** An agent's look, falling back to the host's default for missing or unknown parts. */
export function lookOf(agent: {
  id: string;
  color: BlobColor;
  shape?: string | undefined;
  face?: string | undefined;
}): BlobLook {
  const fallback = defaultLook(agent.id);
  return {
    shape: isShape(agent.shape) ? agent.shape : fallback.shape,
    face: isFace(agent.face) ? agent.face : fallback.face,
    color: agent.color in BLOB_TONES ? agent.color : "sky",
  };
}

/** A random look for a new agent, avoiding ones already in use when possible. */
export function freshLook(taken: readonly BlobLook[], colors: readonly BlobColor[]): BlobLook {
  const usedShapes = new Set(taken.map((l) => l.shape));
  const usedColors = new Set(taken.map((l) => l.color));
  const pick = <T>(all: readonly T[], used: Set<T>): T | undefined => {
    const free = all.filter((v) => !used.has(v));
    const pool = free.length > 0 ? free : all;
    return pool[Math.floor(Math.random() * pool.length)];
  };
  return {
    shape: pick(BLOB_SHAPES, usedShapes) ?? "orb",
    face: BLOB_FACES[Math.floor(Math.random() * BLOB_FACES.length)] ?? "calm",
    color: pick(colors, usedColors) ?? "sky",
  };
}
