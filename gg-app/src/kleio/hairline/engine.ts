// The Hairline instrument's renderer: one transparent WebGL2 canvas in the
// orb's box. Each frame it works out the pose, cross-fades toward it and
// draws only when something changed; it stops its loop once settled.

import { pageZoom } from "../flip";
import type { OrbMood } from "../VoiceOrb";
import { poseAt, type Pose } from "./motion";
import { FRAG, VERT } from "./shader";

export interface Hairline {
  setState(mood: OrbMood, reducedMotion: boolean): void;
  dispose(): void;
}

type Shown = Pose & { cursorAmt: number };

// Rates (1/s) the cross-fading values ease at; the rest follow at once.
const SMOOTH: Partial<Record<keyof Shown, number>> = {
  assemble: 7,
  live: 7,
  dim: 7,
  muted: 7,
  retract: 7,
  extend: 18,
  cursorAmt: 7,
  yaw: 6,
  pitch: 6,
  amp: 25,
  echoAmp: 25,
  inAmp: 25,
};
const ROTATIONS = ["seg", "dots", "outer"] as const;
const POSE_UNIFORMS: readonly (readonly [string, keyof Shown])[] = [
  ["uAssemble", "assemble"],
  ["uLive", "live"],
  ["uDim", "dim"],
  ["uMuted", "muted"],
  ["uRetract", "retract"],
  ["uAmp", "amp"],
  ["uEchoAmp", "echoAmp"],
  ["uExtend", "extend"],
  ["uInAmp", "inAmp"],
  ["uCursorAmt", "cursorAmt"],
  ["uYaw", "yaw"],
  ["uPitch", "pitch"],
  ["uPhase", "phase"],
  ["uSeg", "seg"],
  ["uDots", "dots"],
  ["uOuter", "outer"],
];
const OTHER_UNIFORMS = ["uRes", "uDpr", "uCursor", "uCursorLag"];
// These moods hold one pose, so their loop can stop once the fade lands.
const STILL: ReadonlySet<OrbMood> = new Set<OrbMood>(["muted", "ended"]);
const MAX_PIXEL_RATIO = 2;
/** How long a lost context may take to come back before the orb gives WebGL up. */
export const RESTORE_MS = 1000;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL2: no shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(`Shader error: ${gl.getShaderInfoLog(shader) ?? ""}`);
  return shader;
}

/**
 * Starts the instrument in `host`. Throws when WebGL2 or the shader isn't
 * there; calls `onFail` (after cleaning up) if a lost context stays lost.
 */
export function createHairline(host: HTMLElement, onFail: (reason: unknown) => void): Hairline {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
  host.append(canvas);
  const context = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  if (!context) {
    canvas.remove();
    throw new Error("WebGL2 unavailable");
  }
  const gl: WebGL2RenderingContext = context;

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let loc: Record<string, WebGLUniformLocation | null> = {};
  const init = (): void => {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Shader error: ${gl.getProgramInfoLog(program) ?? ""}`);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    loc = {};
    for (const name of [...OTHER_UNIFORMS, ...POSE_UNIFORMS.map(([uniform]) => uniform)])
      loc[name] = gl.getUniformLocation(program, name);
  };
  try {
    init();
  } catch (e) {
    canvas.remove();
    throw e;
  }

  let mood: OrbMood = "listening";
  let reduced = false;
  let age = 0;
  let clock = 0;
  let previous: number | undefined;
  let raf = 0;
  let dirty = true;
  let lastSignature = "";
  let shown: Shown | null = null;
  // Where thinking left the rings, so no later mood snaps them home.
  const base = { seg: 0, dots: 0, outer: 0, scan: 0 };
  let cursor = 0;
  let cursorLag = 0;
  let ratio = 1;
  let lost = false;
  let disposed = false;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;

  // The app's own zoom enlarges the box on screen, so it counts as pixel ratio.
  const pixelRatio = (): number =>
    Math.min((window.devicePixelRatio || 1) * pageZoom(), MAX_PIXEL_RATIO);

  const wake = (): void => {
    dirty = true;
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  };

  const resize = (): void => {
    ratio = pixelRatio();
    const w = Math.max(1, Math.round(host.clientWidth * ratio));
    const h = Math.max(1, Math.round(host.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    wake();
  };

  const targetAt = (): Shown => {
    const pose = poseAt(mood, age, clock, reduced);
    const lag = poseAt(mood, Math.max(0, age - 0.12), clock - 0.12, reduced);
    let cursorAmt = 0;
    if (mood === "thinking") {
      cursor = pose.scan + base.scan;
      cursorLag = lag.scan + base.scan;
      cursorAmt = pose.scanAmt;
    } else if (mood === "connecting") {
      cursor = (pose.seek * Math.PI) / 2;
      cursorLag = (lag.seek * Math.PI) / 2;
      cursorAmt = pose.seekAmt;
    }
    const target: Shown = { ...pose, cursorAmt };
    for (const key of ROTATIONS) target[key] += base[key];
    return target;
  };

  function frame(now: number): void {
    raf = 0;
    // Hidden or lost: the clock pauses; showing or restoring wakes the loop.
    if (document.hidden || lost) {
      previous = undefined;
      return;
    }
    if (pixelRatio() !== ratio) resize();
    const animate = !reduced;
    const dt = previous === undefined ? 0 : Math.min((now - previous) / 1000, 0.06);
    previous = now;
    if (animate) {
      age += dt;
      clock += dt;
    }
    const target = targetAt();
    let landed = true;
    if (!shown || !animate) shown = { ...target };
    else {
      for (const key of Object.keys(target) as (keyof Shown)[]) {
        const rate = SMOOTH[key];
        const next = rate
          ? shown[key] + (target[key] - shown[key]) * (1 - Math.exp(-dt * rate))
          : target[key];
        // Land exactly once the rest is imperceptible, so a settled pose stops redrawing.
        shown[key] = Math.abs(target[key] - next) < 5e-4 ? target[key] : next;
        if (shown[key] !== target[key]) landed = false;
      }
    }
    const pose = shown;
    const signature = [
      canvas.width,
      canvas.height,
      cursor,
      cursorLag,
      ...POSE_UNIFORMS.map(([, key]) => Math.round(pose[key] * 1e5)),
    ].join();
    if (dirty || signature !== lastSignature) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(loc.uRes ?? null, canvas.width, canvas.height);
      gl.uniform1f(loc.uDpr ?? null, ratio);
      gl.uniform1f(loc.uCursor ?? null, cursor);
      gl.uniform1f(loc.uCursorLag ?? null, cursorLag);
      for (const [uniform, key] of POSE_UNIFORMS) gl.uniform1f(loc[uniform] ?? null, pose[key]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      dirty = false;
      lastSignature = signature;
    }
    if (animate && !(STILL.has(mood) && landed)) raf = requestAnimationFrame(frame);
    else previous = undefined;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const onVisibility = (): void => {
    previous = undefined;
    if (!document.hidden) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(restoreTimer);
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    // Hand the GPU context back now; webviews allow only a handful at once.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
  };
  const fail = (reason: unknown): void => {
    if (disposed) return;
    dispose();
    onFail(reason);
  };
  function onLost(event: Event): void {
    event.preventDefault();
    lost = true;
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(
      () => fail(new Error("WebGL context lost and not restored")),
      RESTORE_MS,
    );
  }
  function onRestored(): void {
    clearTimeout(restoreTimer);
    try {
      init();
    } catch (e) {
      fail(e);
      return;
    }
    lost = false;
    wake();
  }
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  resize();

  return {
    setState(next, still) {
      if (disposed || (next === mood && still === reduced)) return;
      if (next !== mood) {
        if (mood === "thinking") {
          const left = poseAt("thinking", age, clock, reduced);
          for (const key of ROTATIONS) base[key] += left[key];
          base.scan += left.scan;
        }
        age = 0;
      }
      mood = next;
      reduced = still;
      wake();
    },
    dispose,
  };
}
