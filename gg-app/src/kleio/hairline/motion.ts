// The Hairline instrument's motion: every timing, envelope and per-mood pose.
// Pure functions of time and of the levels heard, ported from the selected mockup.

import type { OrbMood } from "../VoiceOrb";

export interface Pose {
  assemble: number;
  live: number;
  dim: number;
  muted: number;
  retract: number;
  amp: number;
  echoAmp: number;
  inAmp: number;
  extend: number;
  scanAmt: number;
  scan: number;
  seekAmt: number;
  seek: number;
  yaw: number;
  pitch: number;
  phase: number;
  seg: number;
  dots: number;
  outer: number;
}

/** One frame's measured levels, 0–1 each; null where nothing was measured. */
export interface Heard {
  /** Her voice now. */
  readonly out: number | null;
  /** Her voice as the ring showed it ECHO_DELAY ago. */
  readonly echo: number | null;
  /** The person's voice. */
  readonly in: number | null;
}

export const UNHEARD: Heard = { out: null, echo: null, in: null };
/** How far the echo trace runs behind the ring, in seconds. */
export const ECHO_DELAY = 0.16;

export interface Detents {
  seg: number;
  dots: number;
  outer: number;
  scan: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export const ease = (x: number): number => {
  const n = clamp01(x);
  return n * n * n * (n * (n * 6 - 15) + 10);
};

const wrap = (t: number, period: number): number => ((t % period) + period) % period;

type Beats = readonly (readonly [at: number, power: number])[];

// Her voice before it is measured: a fixed 6.8 s phrase of eight syllables with rests.
const PHRASE = 6.8;
const SYLLABLES: Beats = [
  [0.42, 0.72],
  [0.86, 0.95],
  [1.5, 0.58],
  [2.55, 1],
  [3.1, 0.7],
  [4.05, 0.88],
  [4.75, 0.62],
  [5.55, 0.48],
];

export function voiceAt(t: number): number {
  const phrase = wrap(t, PHRASE);
  let v = 0;
  for (const [at, power] of SYLLABLES) v += power * Math.exp(-(((phrase - at) / 0.23) ** 2));
  return clamp01(v * (0.86 + 0.14 * Math.sin(t * 19.7) * Math.sin(t * 7.3 + 1.1)));
}

// Thinking indexes each layer by a detent, then holds: never a free spin.
export const CYCLE = 3.2;
export const STEPS: Readonly<Detents> = { seg: 0.42, dots: -0.21, outer: -0.31, scan: Math.PI / 4 };
const WINDOWS: Readonly<Record<keyof Detents, readonly [number, number]>> = {
  seg: [0, 0.9],
  dots: [0.3, 1.15],
  outer: [0.55, 1.5],
  scan: [0, 0.75],
};

export function thinkingAt(t: number): Detents {
  const n = Math.floor(t / CYCLE);
  const local = t - n * CYCLE;
  const at = (key: keyof Detents): number => {
    const [start, end] = WINDOWS[key];
    return STEPS[key] * (n + ease((local - start) / (end - start)));
  };
  return { seg: at("seg"), dots: at("dots"), outer: at("outer"), scan: at("scan") };
}

/**
 * The pose `t` seconds into `mood`; `clock` runs across moods, so the drift
 * never restarts. `heard` moves the voice traces; the still poses ignore it.
 */
export function poseAt(
  mood: OrbMood,
  t: number,
  clock: number,
  reduced = false,
  heard: Heard = UNHEARD,
): Pose {
  const p: Pose = {
    assemble: 1,
    live: 0.92,
    dim: 1,
    muted: 0,
    retract: 0,
    amp: 0,
    echoAmp: 0,
    inAmp: 0,
    extend: 0,
    scanAmt: 0,
    scan: 0,
    seekAmt: 0,
    seek: 0,
    yaw: 0,
    pitch: 0,
    phase: 0,
    seg: 0,
    dots: 0,
    outer: 0,
  };
  const drift = (gain: number): void => {
    if (reduced) return;
    p.yaw = 0.028 * gain * Math.sin(clock * 0.37);
    p.pitch = 0.02 * gain * Math.sin(clock * 0.29 + 1.3);
  };
  switch (mood) {
    case "connecting": {
      p.live = 0.62;
      p.assemble = reduced ? 1 : ease(t / 2);
      p.seekAmt = reduced ? 1 : ease((t - 1.6) / 0.5);
      const s = Math.max(0, t - 2.1);
      const n = Math.floor(s / 1.2);
      // Quarter turns, left unwrapped: wrapped, the cursor and its trail land
      // on opposite sides of the seam and light the whole track.
      p.seek = reduced ? 0 : n + ease((s - n * 1.2) / 0.45);
      break;
    }
    case "idle":
    case "listening":
      drift(1);
      // Unmeasured, the person's voice is never imitated: the track stays quiet.
      p.inAmp = reduced ? 0 : 0.009 * (heard.in ?? 0);
      p.phase = reduced ? 0 : clock;
      if (mood === "idle") p.dim = 0.75;
      break;
    case "thinking":
      drift(0.5);
      p.live = 0.8;
      Object.assign(p, reduced ? STEPS : thinkingAt(t));
      p.scanAmt = reduced ? 1 : ease(t / 0.45);
      break;
    case "speaking": {
      drift(0.6);
      p.live = 1;
      const v = reduced ? 0.55 : (heard.out ?? voiceAt(t));
      const echo = reduced ? 0.45 : (heard.echo ?? voiceAt(t - ECHO_DELAY));
      p.amp = 0.024 * v;
      p.echoAmp = 0.018 * echo;
      p.extend = v;
      p.phase = reduced ? 1.3 : clock;
      break;
    }
    case "muted":
      Object.assign(p, { muted: 1, dim: 0.62, live: 0.55 });
      break;
    case "ended":
      Object.assign(p, { retract: 1, dim: 0.8, live: 0.6 });
      break;
  }
  return p;
}
