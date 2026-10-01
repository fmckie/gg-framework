// An agent drawn as a little blob character: a body shape, a face and a
// colour (see blobLook.ts). Glossy gradient body, one soft highlight, dark
// glossy eyes with a catchlight. Drawn in a 100×100 box so it stays crisp
// from list rows (28–36px) up to the form's live preview.

import { useId } from "react";
import { BLOB_TONES, lookOf, type BlobFaceKind, type BlobLook, type BlobShape } from "./blobLook";
import type { Blob, BlobColor } from "./kleioApi";

const INK = "#1b1424";
const BLUSH = "#ff6f91";
const TONGUE = "#ff8da4";

/** A rounded polygon through the midpoints of `points` (quadratic corners). */
function smoothPath(points: readonly (readonly [number, number])[]): string {
  const n = points.length;
  const mid = (a: readonly [number, number], b: readonly [number, number]): string =>
    `${((a[0] + b[0]) / 2).toFixed(2)} ${((a[1] + b[1]) / 2).toFixed(2)}`;
  const at = (i: number): readonly [number, number] => points[i % n] ?? [50, 50];
  let d = `M${mid(at(n - 1), at(0))}`;
  for (let i = 0; i < n; i++) {
    const p = at(i);
    d += ` Q${p[0].toFixed(2)} ${p[1].toFixed(2)} ${mid(p, at(i + 1))}`;
  }
  return `${d} Z`;
}

/** A soft five-point star. */
function starPath(): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 50 : 27;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    pts.push([50 + r * Math.cos(a), 55 + r * Math.sin(a)]);
  }
  return smoothPath(pts);
}

/** A cotton-ball outline: bumps around a circle. */
function puffPath(): string {
  const n = 9;
  const R = 34;
  const bump = 14.5;
  const pt = (i: number): string => {
    const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
    return `${(50 + R * Math.cos(a)).toFixed(2)} ${(53 + R * Math.sin(a)).toFixed(2)}`;
  };
  let d = `M${pt(0)}`;
  for (let i = 1; i <= n; i++) d += ` A${bump} ${bump} 0 0 1 ${pt(i)}`;
  return `${d} Z`;
}

interface ShapeGeometry {
  body: string;
  /** Where the face sits, and how big it is. */
  face: { x: number; y: number; scale: number };
  /** The soft highlight on the upper left. */
  shine: { x: number; y: number; rx: number; ry: number; rotate: number };
}

const SHAPES: Record<BlobShape, ShapeGeometry> = {
  orb: {
    body: "M50 12 C74 12 92 30 92 53 C92 76 74 92 50 92 C26 92 8 76 8 53 C8 30 26 12 50 12 Z",
    face: { x: 50, y: 54, scale: 1 },
    shine: { x: 32, y: 30, rx: 15, ry: 9, rotate: -32 },
  },
  mochi: {
    body: "M50 20 C77 20 94 41 94 63 C94 81 79 89 50 89 C21 89 6 81 6 63 C6 41 23 20 50 20 Z",
    face: { x: 50, y: 60, scale: 1 },
    shine: { x: 31, y: 37, rx: 15, ry: 8, rotate: -24 },
  },
  drop: {
    body: "M50 6 C57 22 89 43 89 64 C89 82 72 94 50 94 C28 94 11 82 11 64 C11 43 43 22 50 6 Z",
    face: { x: 50, y: 66, scale: 0.95 },
    shine: { x: 35, y: 50, rx: 10, ry: 7, rotate: -40 },
  },
  puff: {
    body: puffPath(),
    face: { x: 50, y: 56, scale: 0.95 },
    shine: { x: 33, y: 33, rx: 12, ry: 8, rotate: -30 },
  },
  pill: {
    body: "M34 24 H66 A28 28 0 0 1 66 80 H34 A28 28 0 0 1 34 24 Z",
    face: { x: 50, y: 53, scale: 0.95 },
    shine: { x: 30, y: 36, rx: 13, ry: 6, rotate: -14 },
  },
  cube: {
    body: "M35 13 H65 Q89 13 89 37 V67 Q89 91 65 91 H35 Q11 91 11 67 V37 Q11 13 35 13 Z",
    face: { x: 50, y: 55, scale: 1 },
    shine: { x: 30, y: 30, rx: 13, ry: 8, rotate: -28 },
  },
  ghost: {
    body:
      "M50 9 C74 9 89 27 89 50 V82 Q89 93 80 88 Q74 84 68 89 Q62 94 56 89 Q50 84 44 89 " +
      "Q38 94 32 89 Q26 84 20 88 Q11 93 11 82 V50 C11 27 26 9 50 9 Z",
    face: { x: 50, y: 48, scale: 1 },
    shine: { x: 32, y: 28, rx: 13, ry: 8, rotate: -30 },
  },
  star: {
    body: starPath(),
    face: { x: 50, y: 57, scale: 0.78 },
    shine: { x: 37, y: 36, rx: 9, ry: 6, rotate: -30 },
  },
};

const EYE_X = 12.5;

function GlossyEye({ x, big = false }: { x: number; big?: boolean }): React.ReactElement {
  const rx = big ? 6.4 : 5.2;
  const ry = big ? 6.8 : 7.2;
  return (
    <g>
      <ellipse cx={x} cy={0} rx={rx} ry={ry} fill={INK} />
      <circle cx={x - rx * 0.32} cy={-ry * 0.38} r={big ? 2.1 : 1.8} fill="#fff" opacity={0.92} />
    </g>
  );
}

function stroke(d: string, width = 3.2): React.ReactElement {
  return (
    <path
      d={d}
      fill="none"
      stroke={INK}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const happyEye = (x: number): string => `M${x - 5.5} 2 Q${x} -6 ${x + 5.5} 2`;
const closedEye = (x: number): string => `M${x - 5.5} -1 Q${x} 5 ${x + 5.5} -1`;

function Blush(): React.ReactElement {
  return (
    <g fill={BLUSH} opacity={0.38}>
      <ellipse cx={-21} cy={8} rx={5} ry={3} />
      <ellipse cx={21} cy={8} rx={5} ry={3} />
    </g>
  );
}

/** The eyes (blink together) and the rest of the face, around (0, 0). */
function Face({ kind }: { kind: BlobFaceKind }): React.ReactElement {
  switch (kind) {
    case "calm":
      return (
        <>
          <g className="blob-av-eyes">
            <GlossyEye x={-EYE_X} />
            <GlossyEye x={EYE_X} />
          </g>
          {stroke("M-4.5 11 Q0 14.5 4.5 11", 2.8)}
        </>
      );
    case "happy":
      return (
        <>
          <Blush />
          {stroke(happyEye(-EYE_X))}
          {stroke(happyEye(EYE_X))}
          <path
            d="M-7 9 Q0 20 7 9 Z"
            fill={INK}
            stroke={INK}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        </>
      );
    case "curious":
      return (
        <>
          <g className="blob-av-eyes">
            <GlossyEye x={-EYE_X} />
            <GlossyEye x={EYE_X} big />
          </g>
          {stroke("M6 -13.5 L18 -16", 2.8)}
          <ellipse cx={3} cy={13} rx={2.8} ry={3.2} fill={INK} />
        </>
      );
    case "sleepy":
      return (
        <>
          {stroke(closedEye(-EYE_X))}
          {stroke(closedEye(EYE_X))}
          <ellipse cx={0} cy={12.5} rx={2.6} ry={2} fill={INK} />
        </>
      );
    case "wink":
      return (
        <>
          <Blush />
          <GlossyEye x={-EYE_X} />
          {stroke(happyEye(EYE_X))}
          {stroke("M-6 9.5 Q0 16 6 9.5", 3)}
        </>
      );
    case "focused":
      return (
        <>
          <g className="blob-av-eyes" fill={INK}>
            <rect x={-EYE_X - 6.5} y={-2.6} width={13} height={5.2} rx={2.6} />
            <rect x={EYE_X - 6.5} y={-2.6} width={13} height={5.2} rx={2.6} />
          </g>
          {stroke("M-4.5 12.5 H4.5", 2.8)}
        </>
      );
    case "surprised":
      return (
        <>
          <g className="blob-av-eyes">
            <GlossyEye x={-EYE_X} big />
            <GlossyEye x={EYE_X} big />
          </g>
          <ellipse cx={0} cy={14} rx={3.8} ry={4.8} fill={INK} />
        </>
      );
    case "cheeky":
      return (
        <>
          <Blush />
          <g className="blob-av-eyes">
            <GlossyEye x={-EYE_X} />
            <GlossyEye x={EYE_X} />
          </g>
          <ellipse cx={2.8} cy={14.2} rx={3} ry={3.4} fill={TONGUE} />
          {stroke("M-7 9.5 Q0 16 7 9.5", 3)}
        </>
      );
  }
}

export function BlobAvatar({
  look,
  size = 44,
  live = false,
  animated = false,
  className,
}: {
  look: BlobLook;
  size?: number;
  /** Working right now: a gentle bounce. */
  live?: boolean;
  /** Idle life (blinking) — for the larger, single instances. */
  animated?: boolean;
  className?: string;
}): React.ReactElement {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const geo = SHAPES[look.shape] ?? SHAPES.orb;
  const [light, base, shade] = BLOB_TONES[look.color] ?? BLOB_TONES.sky;
  const classes = ["blob-av", live && "is-live", animated && "is-animated", className]
    .filter(Boolean)
    .join(" ");
  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="30%" r="78%" fx="32%" fy="24%">
          <stop offset="0%" stopColor={light} />
          <stop offset="48%" stopColor={base} />
          <stop offset="100%" stopColor={shade} />
        </radialGradient>
        <radialGradient id={`${id}-shine`}>
          <stop offset="0%" stopColor="#fff" stopOpacity={0.85} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>
      <g className="blob-av-body">
        <path d={geo.body} fill={`url(#${id}-body)`} />
        <ellipse
          cx={geo.shine.x}
          cy={geo.shine.y}
          rx={geo.shine.rx}
          ry={geo.shine.ry}
          transform={`rotate(${geo.shine.rotate} ${geo.shine.x} ${geo.shine.y})`}
          fill={`url(#${id}-shine)`}
        />
        <g transform={`translate(${geo.face.x} ${geo.face.y}) scale(${geo.face.scale})`}>
          <Face kind={look.face} />
        </g>
      </g>
    </svg>
  );
}

/** An agent's blob from its stored look (older hosts: the id's default). */
export function AgentAvatar({
  agent,
  size = 36,
  live = false,
  animated = false,
}: {
  agent: Pick<Blob, "id" | "color" | "shape" | "face">;
  size?: number;
  live?: boolean;
  animated?: boolean;
}): React.ReactElement {
  return <BlobAvatar look={lookOf(agent)} size={size} live={live} animated={animated} />;
}

/** Where each of up to three member blobs sits in a group's picture. */
const CLUSTER: Record<number, readonly { x: number; y: number; s: number }[]> = {
  1: [{ x: 0.5, y: 0.5, s: 0.86 }],
  2: [
    { x: 0.34, y: 0.4, s: 0.62 },
    { x: 0.66, y: 0.62, s: 0.62 },
  ],
  3: [
    { x: 0.5, y: 0.3, s: 0.52 },
    { x: 0.27, y: 0.68, s: 0.52 },
    { x: 0.73, y: 0.68, s: 0.52 },
  ],
};

/**
 * A group's picture: its first three members' blobs huddled together, so a
 * group reads as the agents in it. No members yet (or none still known):
 * an empty outline in the group's colour.
 */
export function GroupAvatar({
  members,
  color,
  size = 36,
}: {
  members: readonly Pick<Blob, "id" | "color" | "shape" | "face">[];
  color: BlobColor;
  size?: number;
}): React.ReactElement {
  const shown = members.slice(0, 3);
  const spots = CLUSTER[shown.length];
  if (!spots) {
    return (
      <span
        className="blob-cluster is-empty"
        style={{ width: size, height: size, borderColor: BLOB_TONES[color]?.[1] }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span className="blob-cluster" style={{ width: size, height: size }} aria-hidden="true">
      {shown.map((m, i) => {
        const spot = spots[i] ?? { x: 0.5, y: 0.5, s: 0.5 };
        const px = Math.round(size * spot.s);
        return (
          <span
            key={m.id}
            className="blob-cluster-item"
            style={{
              left: size * spot.x - px / 2,
              top: size * spot.y - px / 2,
              zIndex: i + 1,
            }}
          >
            <BlobAvatar look={lookOf(m)} size={px} />
          </span>
        );
      })}
    </span>
  );
}
