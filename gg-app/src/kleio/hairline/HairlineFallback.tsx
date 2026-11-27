// The Hairline instrument drawn flat in SVG, for when WebGL2 can't run: each
// mood in its still (reduced-motion) pose, same box, same colours. No
// parallax, refraction or reflections, and nothing moves.

import { useId } from "react";
import type { OrbMood } from "../VoiceOrb";
import { poseAt } from "./motion";

// The shader's plane units to the 380px box (its view is 1.03 units to the edge).
const UNIT = 190 / 1.03;
const TAU = Math.PI * 2;
const INK = "#F7F0E8";
const INK_MUTED = "#B3B5BD";
const GLOW = "#FFA39E";
const GLOW_MUTED = "#9EA1AB";

const R = {
  hair: 0.958 * UNIT,
  major: [0.905 * UNIT, 0.948 * UNIT],
  minor: [0.918 * UNIT, 0.94 * UNIT],
  arcs: 0.865 * UNIT,
  arcsRule: 0.835 * UNIT,
  dots: 0.79 * UNIT,
  bracket: 0.745 * UNIT,
  index: [0.722 * UNIT, 0.758 * UNIT],
  ring: 0.7 * UNIT,
  echo: 0.672 * UNIT,
  track: 0.632 * UNIT,
  core: 0.4417 * UNIT,
} as const;

/** Start and length in degrees clockwise from 12 o'clock, and stroke width: the shader's SEGS. */
const ARCS: readonly (readonly [start: number, length: number, width: number])[] = [
  [8, 38, 2.2],
  [60, 7, 2.2],
  [94, 66, 1],
  [186, 24, 2.2],
  [222, 4, 2.2],
  [250, 72, 1],
  [336, 13, 2.2],
];

const n = (value: number): string => String(Math.round(value * 100) / 100);
const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (radians: number): number => (radians * 180) / Math.PI;
/** The point at radius `r`, `a` radians clockwise from 12 o'clock. */
const at = (r: number, a: number): string => `${n(r * Math.sin(a))} ${n(-r * Math.cos(a))}`;
const spoke = (r0: number, r1: number, a: number): string => `M${at(r0, a)}L${at(r1, a)}`;
const arc = (r: number, a0: number, length: number): string =>
  `M${at(r, a0)}A${n(r)} ${n(r)} 0 ${length > Math.PI ? 1 : 0} 1 ${at(r, a0 + length)}`;
/** A zero-length stroke: with round caps it draws a dot as wide as the stroke. */
const dot = (r: number, a: number): string => `M${at(r, a)}l0.01 0`;

const steps = (count: number): number[] => Array.from({ length: count }, (_, i) => i);
const MINOR_TICKS = steps(144)
  .filter((i) => i % 12 !== 0)
  .map((i) => spoke(R.minor[0], R.minor[1], (i * TAU) / 144))
  .join("");
const MAJOR_TICKS = steps(12)
  .map((i) => spoke(R.major[0], R.major[1], (i * TAU) / 12))
  .join("");
const SMALL_DOTS = steps(90)
  .filter((i) => i % 15 !== 0)
  .map((i) => dot(R.dots, (i * TAU) / 90))
  .join("");
const LARGE_DOTS = steps(6)
  .map((i) => dot(R.dots, (i * TAU) / 6))
  .join("");
const INDICES = steps(4)
  .map((i) => spoke(R.index[0], R.index[1], (i * TAU) / 4))
  .join("");
const BRACKETS = steps(4)
  .map(
    (i) =>
      arc(R.bracket, (i * TAU) / 4 + rad(5), rad(7)) +
      arc(R.bracket, (i * TAU) / 4 - rad(12), rad(7)),
  )
  .join("");

/** The shader's voice trace: the radial offset at angle `th` (integer lobes, so the ring closes). */
function wave(th: number, phase: number): number {
  const m = 0.6 + 0.4 * Math.sin(4 * th - 1.7 * phase);
  return (
    0.62 * Math.sin(31 * th + 9 * phase) * m +
    0.16 * Math.sin(57 * th - 14 * phase) +
    0.22 * Math.sin(13 * th + 5 * phase)
  );
}

// Enough points for the trace's finest ripple; many more and the hairline
// breaks into beads, each sliver of a segment antialiased on its own.
const TRACE_POINTS = 480;

/** A ring at `r` deflected by the frozen voice trace. */
function tracePath(r: number, amp: number, phase: number, turn: number): string {
  const points = steps(TRACE_POINTS).map((i) => {
    const th = (i * TAU) / TRACE_POINTS;
    const radius = r + amp * UNIT * wave(th + turn, phase);
    return `${(radius * Math.cos(th)).toFixed(3)} ${(-radius * Math.sin(th)).toFixed(3)}`;
  });
  return `M${points.join("L")}Z`;
}

export function HairlineFallback({ mood }: { readonly mood: OrbMood }): React.ReactElement {
  const glass = useId();
  const plate = useId();
  const pose = poseAt(mood, 0, 0, true);
  const muted = pose.muted > 0;
  const ink = muted ? INK_MUTED : INK;
  const level = pose.live * pose.dim;
  const cursorOn = mood === "connecting" || mood === "thinking";
  const cursor = mood === "thinking" ? pose.scan : (pose.seek * Math.PI) / 2;
  const speaking = pose.amp > 0;
  const trace = speaking ? tracePath(R.ring, pose.amp, pose.phase, 0) : null;
  const glow = {
    stroke: muted ? GLOW_MUTED : GLOW,
    strokeWidth: 7,
    strokeOpacity: n((speaking ? 0.16 : 0.08) * (muted ? 0.4 : 1)),
  };
  return (
    <svg
      className="hairline-flat"
      data-mood={mood}
      viewBox="-190 -190 380 380"
      width="100%"
      height="100%"
      style={{ display: "block", pointerEvents: "none" }}
      fill="none"
      stroke={ink}
      strokeLinecap="butt"
    >
      <defs>
        <radialGradient id={glass} cx="42%" cy="36%" r="70%">
          <stop offset="0" stopColor="#151114" />
          <stop offset="0.7" stopColor="#060506" />
          <stop offset="1" stopColor="#0c0a0c" />
        </radialGradient>
        <radialGradient id={plate} gradientUnits="userSpaceOnUse" cx="0" cy="0" r={n(0.99 * UNIT)}>
          <stop offset="0.6" stopColor="#030203" stopOpacity="0.34" />
          <stop offset="1" stopColor="#030203" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle data-layer="plate" r={n(0.99 * UNIT)} fill={`url(#${plate})`} stroke="none" />
      <circle
        data-layer="core"
        r={n(R.core)}
        fill={`url(#${glass})`}
        fillOpacity="0.9"
        stroke="#9a959c"
        strokeOpacity="0.45"
        strokeWidth="0.8"
      />
      <g opacity={n(level)}>
        <g
          data-layer="bezel"
          opacity={n(1 - 0.82 * pose.retract)}
          transform={`rotate(${n(deg(pose.outer))})`}
        >
          <path d={MINOR_TICKS} strokeWidth="0.8" strokeOpacity="0.42" />
          <path d={MAJOR_TICKS} strokeWidth="1.25" strokeOpacity="0.85" />
          <circle r={n(R.hair)} strokeWidth="0.7" strokeOpacity="0.35" />
        </g>
        <g
          data-layer="arcs"
          opacity={n(1 - 0.9 * pose.retract)}
          transform={`rotate(${n(-deg(pose.seg))})`}
        >
          {ARCS.map(([start, length, width]) => {
            const bold = width > 1.5;
            const stretch = bold ? 1 + 0.32 * pose.extend : 1;
            return (
              <path
                key={start}
                d={arc(R.arcs, rad(start), rad(length) * stretch)}
                strokeWidth={width}
                strokeOpacity={bold ? 0.82 : 0.5}
              />
            );
          })}
          <circle r={n(R.arcsRule)} strokeWidth="0.6" strokeOpacity="0.22" />
        </g>
        <g
          data-layer="dots"
          opacity={n(1 - 0.9 * pose.retract)}
          transform={`rotate(${n(deg(pose.dots))})`}
          strokeLinecap="round"
        >
          <path d={SMALL_DOTS} strokeWidth="1.7" strokeOpacity="0.48" />
          <path d={LARGE_DOTS} strokeWidth="2.6" strokeOpacity="0.8" />
        </g>
        <g data-layer="ring" opacity={n(1 - 0.45 * pose.retract)} strokeLinejoin="round">
          {trace ? <path d={trace} {...glow} /> : <circle r={n(R.ring)} {...glow} />}
          {trace ? (
            <path d={trace} strokeWidth="1.3" />
          ) : (
            <circle r={n(R.ring)} strokeWidth="1.3" />
          )}
        </g>
        <g data-layer="indices" opacity={n(1 - 0.7 * pose.retract)}>
          <path d={INDICES} strokeWidth="1.4" strokeOpacity="0.9" />
          <path d={BRACKETS} strokeWidth="1" strokeOpacity="0.55" />
        </g>
        {speaking ? (
          <path
            data-layer="echo"
            d={tracePath(R.echo, pose.echoAmp, pose.phase - 0.16, 0.35)}
            strokeWidth="0.8"
            strokeLinejoin="round"
            strokeOpacity="0.5"
          />
        ) : null}
        {cursorOn ? (
          <g data-layer="cursor" transform={`rotate(${n(deg(cursor))})`}>
            <circle r={n(R.track)} strokeWidth="0.6" strokeOpacity="0.2" />
            <path d={arc(R.track, -rad(4), rad(8))} strokeWidth="2" strokeOpacity="0.9" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}
