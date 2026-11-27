// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrbMood } from "../VoiceOrb";
import { createHairline, RESTORE_MS, type Hairline } from "./engine";
import { STEPS } from "./motion";
import {
  fakeFrames,
  fakeGl,
  fakeLevels,
  stubCanvas,
  type FakeGl,
  type FakeLevels,
  type Frames,
} from "./testGl";

let glx: FakeGl;
let frames: Frames;
let host: HTMLDivElement;
let hidden = false;
const onFail = vi.fn();

beforeEach(() => {
  glx = fakeGl();
  frames = fakeFrames();
  stubCanvas(glx);
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 380 });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: 380 });
  document.body.append(host);
});

afterEach(() => {
  host.remove();
  Reflect.deleteProperty(document, "hidden");
  document.documentElement.style.removeProperty("--zoom");
  onFail.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function start(mood: OrbMood, reducedMotion = false, levels?: FakeLevels): Hairline {
  const orb = createHairline(host, onFail, levels?.read);
  orb.setState(mood, reducedMotion);
  return orb;
}

const u = (name: string): number => glx.uniforms.get(name) ?? Number.NaN;
const series = (name: string, from = 0): number[] =>
  glx.drawn.slice(from).map((frame) => frame[name] ?? Number.NaN);

describe("the Hairline instrument, drawn", () => {
  it.each([
    ["idle", { uLive: 0.92, uDim: 0.75, uMuted: 0, uRetract: 0, uCursorAmt: 0 }],
    ["connecting", { uLive: 0.62, uDim: 1, uMuted: 0, uRetract: 0, uAssemble: 1, uCursorAmt: 1 }],
    ["listening", { uLive: 0.92, uDim: 1, uMuted: 0, uRetract: 0, uCursorAmt: 0 }],
    ["thinking", { uLive: 0.8, uDim: 1, uMuted: 0, uRetract: 0, uCursorAmt: 1 }],
    ["speaking", { uLive: 1, uDim: 1, uMuted: 0, uRetract: 0, uCursorAmt: 0 }],
    ["muted", { uLive: 0.55, uDim: 0.62, uMuted: 1, uRetract: 0, uCursorAmt: 0 }],
    ["ended", { uLive: 0.6, uDim: 0.8, uMuted: 0, uRetract: 1, uCursorAmt: 0 }],
  ] as const)("%s settles at its own levels", (mood, levels) => {
    start(mood);
    frames.run(4);
    for (const [name, value] of Object.entries(levels)) expect(u(name)).toBeCloseTo(value, 3);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("connecting builds on over 2 s, then steps the cursor between the cardinals", () => {
    start("connecting");
    frames.run(1 / 60);
    expect(u("uAssemble")).toBe(0);
    frames.run(1);
    expect(u("uAssemble")).toBeGreaterThan(0.2);
    expect(u("uAssemble")).toBeLessThan(0.8);
    frames.run(1.6);
    expect(u("uAssemble")).toBe(1);
    expect(u("uCursor")).toBeCloseTo(Math.PI / 2, 5);
    frames.run(1.2);
    expect(u("uCursor")).toBeCloseTo(Math.PI, 5);
    // Past a whole turn the trail still follows the cursor, never the long way round.
    frames.run(8);
    const cursors = series("uCursor");
    const trails = series("uCursorLag");
    cursors.forEach((cursor, i) => {
      expect(cursor - (trails[i] ?? 0)).toBeGreaterThanOrEqual(-1e-9);
      expect(cursor - (trails[i] ?? 0)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    });
    expect(Math.max(...cursors)).toBeGreaterThan(2 * Math.PI);
    expect(Math.max(...series("uYaw").map(Math.abs))).toBe(0);
  });

  it("listening drifts and, with no levels, keeps every trace quiet", () => {
    start("listening");
    frames.run(13);
    expect(Math.max(...series("uInAmp"))).toBe(0);
    expect(Math.max(...series("uAmp"))).toBe(0);
    expect(Math.max(...series("uSeg").map(Math.abs))).toBe(0);
    const yaw = series("uYaw").map(Math.abs);
    expect(Math.max(...yaw)).toBeGreaterThan(0.01);
    expect(Math.max(...yaw)).toBeLessThanOrEqual(0.028);
  });

  it("thinking indexes the rings and holds; they stay there in the next mood", () => {
    const orb = start("thinking");
    frames.run(2);
    const held = { uSeg: STEPS.seg, uDots: STEPS.dots, uOuter: STEPS.outer };
    for (const [name, value] of Object.entries(held)) expect(u(name)).toBeCloseTo(value, 6);
    expect(u("uCursor")).toBeCloseTo(Math.PI / 4, 6);
    frames.run(1);
    for (const [name, value] of Object.entries(held)) expect(u(name)).toBeCloseTo(value, 6);
    orb.setState("listening", false);
    frames.run(2);
    for (const [name, value] of Object.entries(held)) expect(u(name)).toBeCloseTo(value, 6);
    expect(u("uCursorAmt")).toBe(0);
    // A second spell of thinking carries on from there.
    orb.setState("thinking", false);
    frames.run(2);
    expect(u("uSeg")).toBeCloseTo(STEPS.seg * 2, 6);
    expect(u("uCursor")).toBeCloseTo(Math.PI / 2, 6);
  });

  it.each([
    ["no levels at all", undefined],
    ["her level not measured yet", fakeLevels(null, 1)],
  ] as const)("speaking with %s plays the fixed phrase on the ring, echo and arcs", (_, levels) => {
    start("speaking", false, levels);
    frames.run(6.8);
    const amp = series("uAmp");
    expect(Math.max(...amp)).toBeGreaterThan(0.02);
    expect(Math.max(...amp)).toBeLessThanOrEqual(0.024);
    expect(amp[amp.length - 1]).toBeLessThan(0.002);
    expect(Math.max(...series("uEchoAmp"))).toBeGreaterThan(0.015);
    expect(Math.max(...series("uEchoAmp"))).toBeLessThanOrEqual(0.018);
    expect(Math.max(...series("uExtend"))).toBeGreaterThan(0.8);
    expect(Math.max(...series("uInAmp"))).toBe(0);
  });

  it.each([
    ["muted", "uMuted"],
    ["ended", "uRetract"],
  ] as const)("cross-fades into %s over about 0.4 s, then stops drawing", (mood, uniform) => {
    const orb = start("listening");
    frames.run(1);
    orb.setState(mood, false);
    frames.run(0.1);
    expect(u(uniform)).toBeGreaterThan(0.2);
    expect(u(uniform)).toBeLessThan(0.8);
    frames.run(0.4);
    expect(u(uniform)).toBeGreaterThan(0.93);
    frames.run(3);
    expect(u(uniform)).toBe(1);
    expect(u("uYaw")).toBe(0);
    expect(frames.pending()).toBe(0);
    const draws = glx.drawn.length;
    frames.run(1);
    expect(glx.drawn.length).toBe(draws);
    // The next mood starts the loop again and fades back.
    orb.setState("listening", false);
    expect(frames.pending()).toBe(1);
    frames.run(1);
    expect(u(uniform)).toBeLessThan(0.01);
    expect(frames.pending()).toBe(1);
  });

  it("the voice trace follows its phrase within about 0.1 s", () => {
    const orb = start("speaking");
    frames.run(2.55);
    expect(u("uAmp")).toBeGreaterThan(0.015);
    orb.setState("listening", false);
    frames.run(0.1);
    expect(u("uAmp")).toBeLessThan(0.003);
  });

  it("reduced motion draws each mood once, as its still pose", () => {
    const orb = start("speaking", true);
    frames.run(1);
    expect(glx.drawn.length).toBe(1);
    expect(frames.pending()).toBe(0);
    expect(u("uAmp")).toBeCloseTo(0.024 * 0.55, 10);
    expect(u("uEchoAmp")).toBeCloseTo(0.018 * 0.45, 10);
    expect(u("uExtend")).toBe(0.55);
    expect(u("uPhase")).toBe(1.3);
    expect(u("uYaw")).toBe(0);

    // Moods switch at once: the first frame is already the whole pose.
    orb.setState("muted", true);
    frames.run(1 / 60);
    expect(glx.drawn.length).toBe(2);
    expect(u("uMuted")).toBe(1);
    expect(u("uAmp")).toBe(0);
    expect(frames.pending()).toBe(0);

    orb.setState("connecting", true);
    frames.run(1);
    expect(glx.drawn.length).toBe(3);
    expect(u("uAssemble")).toBe(1);
    expect(u("uCursorAmt")).toBe(1);
    expect(u("uCursor")).toBe(0);

    orb.setState("listening", true);
    frames.run(3);
    expect(glx.drawn.length).toBe(4);
    expect(u("uInAmp")).toBe(0);
    expect(u("uYaw")).toBe(0);

    orb.setState("thinking", true);
    frames.run(3);
    expect(glx.drawn.length).toBe(5);
    expect(u("uSeg")).toBe(STEPS.seg);
    expect(u("uCursor")).toBe(Math.PI / 4);

    orb.setState("ended", true);
    frames.run(1);
    expect(glx.drawn.length).toBe(6);
    expect(u("uRetract")).toBe(1);
  });

  it("answers at once when the reduced-motion preference changes during a call", () => {
    const orb = start("speaking");
    frames.run(1);
    expect(frames.pending()).toBe(1);
    orb.setState("speaking", true);
    frames.run(1 / 60);
    expect(u("uAmp")).toBeCloseTo(0.024 * 0.55, 10);
    expect(u("uYaw")).toBe(0);
    expect(frames.pending()).toBe(0);
    orb.setState("speaking", false);
    expect(frames.pending()).toBe(1);
    const draws = glx.drawn.length;
    frames.run(0.5);
    expect(glx.drawn.length).toBeGreaterThan(draws + 20);
  });

  it("pauses while the page is hidden", () => {
    start("listening");
    frames.run(1);
    hidden = true;
    frames.run(1 / 60);
    const draws = glx.drawn.length;
    expect(frames.pending()).toBe(0);
    frames.run(1);
    expect(glx.drawn.length).toBe(draws);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    frames.run(0.2);
    expect(glx.drawn.length).toBeGreaterThan(draws);
  });

  it("sizes the canvas to the box at the pixel ratio, capped at 2", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    start("listening");
    frames.run(1 / 60);
    const canvas = host.querySelector("canvas");
    expect(canvas?.width).toBe(760);
    expect(canvas?.height).toBe(760);
    expect(u("uDpr")).toBe(2);
    vi.stubGlobal("devicePixelRatio", 3);
    frames.run(1 / 60);
    expect(canvas?.width).toBe(760);
    // The app's own zoom enlarges the box on screen, so it counts too.
    vi.stubGlobal("devicePixelRatio", 1);
    document.documentElement.style.setProperty("--zoom", "1.2");
    frames.run(1 / 60);
    expect(canvas?.width).toBe(456);
    expect(u("uDpr")).toBe(1.2);
  });

  it("asks for a transparent context it antialiases itself, and keeps no drawing buffer", () => {
    start("listening");
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
  });
});

describe("the Hairline instrument, hearing", () => {
  it("her level drives the ring, its echo, the arcs and nothing else", () => {
    const levels = fakeLevels(1, 1);
    start("speaking", false, levels);
    frames.run(1);
    // The mockup's limits: about 4.4 px on the ring, 3.3 px on the echo, 32% on the arcs.
    expect(u("uAmp")).toBe(0.024);
    expect(u("uEchoAmp")).toBe(0.018);
    expect(u("uExtend")).toBe(1);
    levels.out = 0.5;
    frames.run(1);
    expect(u("uAmp")).toBeCloseTo(0.012, 10);
    expect(u("uEchoAmp")).toBeCloseTo(0.009, 10);
    expect(u("uExtend")).toBe(0.5);
    levels.out = 0;
    frames.run(1);
    expect(u("uAmp")).toBe(0);
    expect(u("uEchoAmp")).toBe(0);
    expect(u("uExtend")).toBe(0);
    expect(Math.max(...series("uInAmp"))).toBe(0);
  });

  it("the ring follows her level within about 0.1 s, rising and falling", () => {
    const levels = fakeLevels(0, null);
    start("speaking", false, levels);
    frames.run(1);
    levels.out = 1;
    frames.run(0.1);
    expect(u("uAmp")).toBeGreaterThan(0.024 * 0.9);
    expect(u("uExtend")).toBeGreaterThan(0.8);
    frames.run(1);
    levels.out = 0;
    frames.run(0.1);
    expect(u("uAmp")).toBeLessThan(0.024 * 0.1);
    expect(u("uExtend")).toBeLessThan(0.2);
  });

  it("the echo shows the same level 0.16 s later", () => {
    const levels = fakeLevels(0, null);
    start("speaking", false, levels);
    frames.run(1);
    levels.out = 1;
    // Nine frames in (0.15 s) the ring is nearly there and the echo hasn't begun.
    frames.run(0.15);
    expect(u("uAmp")).toBeGreaterThan(0.024 * 0.9);
    expect(u("uEchoAmp")).toBe(0);
    frames.run(2 / 60);
    expect(u("uEchoAmp")).toBeGreaterThan(0);
    frames.run(0.15);
    expect(u("uEchoAmp")).toBeGreaterThan(0.018 * 0.9);
    frames.run(1);
    expect(u("uEchoAmp")).toBe(0.018);
    // And it lets go as late as it took hold.
    levels.out = 0;
    frames.run(0.15);
    expect(u("uAmp")).toBeLessThan(0.024 * 0.1);
    expect(u("uEchoAmp")).toBe(0.018);
    frames.run(0.2);
    expect(u("uEchoAmp")).toBeLessThan(0.018 * 0.1);
  });

  it("the echo starts from nothing each time she begins to speak", () => {
    const levels = fakeLevels(1, 0);
    const orb = start("speaking", false, levels);
    frames.run(1);
    orb.setState("listening", false);
    frames.run(1);
    expect(u("uEchoAmp")).toBe(0);
    orb.setState("speaking", false);
    frames.run(0.15);
    expect(u("uAmp")).toBeGreaterThan(0.024 * 0.9);
    expect(u("uEchoAmp")).toBe(0);
  });

  it("when her voice arrives the ring leaves the fixed phrase for it", () => {
    const levels = fakeLevels(null, null);
    start("speaking", false, levels);
    // 2.55 s is the phrase's loudest syllable.
    frames.run(2.55);
    expect(u("uAmp")).toBeGreaterThan(0.015);
    levels.out = 0.25;
    frames.run(0.1);
    expect(u("uAmp")).toBeLessThan(0.008);
    // The echo still repeats what the ring showed 0.16 s ago: the phrase.
    expect(u("uEchoAmp")).toBeGreaterThan(0.01);
    frames.run(1);
    expect(u("uAmp")).toBeCloseTo(0.006, 10);
    expect(u("uEchoAmp")).toBeCloseTo(0.0045, 10);
    expect(u("uExtend")).toBe(0.25);
  });

  it.each(["listening", "idle"] as const)("your level drives the inner track in %s", (mood) => {
    const levels = fakeLevels(1, 1);
    start(mood, false, levels);
    frames.run(0.1);
    expect(u("uInAmp")).toBeGreaterThan(0.009 * 0.9);
    frames.run(1);
    // The mockup's limit: about 1.7 px.
    expect(u("uInAmp")).toBe(0.009);
    levels.in = 0.5;
    frames.run(1);
    expect(u("uInAmp")).toBeCloseTo(0.0045, 10);
    levels.in = 0;
    frames.run(0.1);
    expect(u("uInAmp")).toBeLessThan(0.009 * 0.1);
    frames.run(1);
    expect(u("uInAmp")).toBe(0);
    // Her level shows nowhere while she isn't speaking.
    for (const name of ["uAmp", "uEchoAmp", "uExtend"]) expect(Math.max(...series(name))).toBe(0);
  });

  it.each(["listening", "idle"] as const)(
    "%s with your level not measured keeps the inner track quiet",
    (mood) => {
      start(mood, false, fakeLevels(1, null));
      frames.run(13);
      expect(Math.max(...series("uInAmp"))).toBe(0);
    },
  );

  it.each(["speaking", "listening", "idle"] as const)(
    "%s reads the levels once a frame",
    (mood) => {
      const levels = fakeLevels(0.4, 0.4);
      start(mood, false, levels);
      frames.run(1);
      expect(levels.reads()).toBe(60);
      frames.run(0.5);
      expect(levels.reads()).toBe(90);
    },
  );

  it.each([
    [7, 1],
    [1.0001, 1],
    [Number.POSITIVE_INFINITY, 1],
    [-3, 0],
    [-0, 0],
    [Number.NEGATIVE_INFINITY, 0],
    [Number.NaN, 0],
  ])("takes a level of %s as %s", (bad, taken) => {
    const levels = fakeLevels(bad, bad);
    const orb = start("speaking", false, levels);
    frames.run(1);
    expect(u("uAmp")).toBe(0.024 * taken);
    expect(u("uEchoAmp")).toBe(0.018 * taken);
    expect(u("uExtend")).toBe(taken);
    orb.setState("listening", false);
    frames.run(1);
    expect(u("uInAmp")).toBe(0.009 * taken);
    for (const drawn of glx.drawn) expect(Object.values(drawn).every(Number.isFinite)).toBe(true);
  });

  it.each(["connecting", "thinking"] as const)("%s shows no level and reads none", (mood) => {
    const levels = fakeLevels(1, 1);
    start(mood, false, levels);
    frames.run(4);
    expect(levels.reads()).toBe(0);
    for (const name of ["uAmp", "uEchoAmp", "uExtend", "uInAmp"])
      expect(Math.max(...series(name))).toBe(0);
  });

  it.each(["muted", "ended"] as const)("%s reads nothing, fading or settled", (mood) => {
    const levels = fakeLevels(1, 1);
    const orb = start("listening", false, levels);
    frames.run(1);
    expect(u("uInAmp")).toBe(0.009);
    const reads = levels.reads();
    orb.setState(mood, false);
    frames.run(4);
    expect(frames.pending()).toBe(0);
    expect(u("uInAmp")).toBe(0);
    expect(levels.reads()).toBe(reads);
    // Changing levels don't wake a settled orb.
    levels.in = 0.2;
    levels.out = 0.9;
    frames.run(1);
    expect(frames.pending()).toBe(0);
    expect(levels.reads()).toBe(reads);
  });

  it("reduced motion reads nothing in any mood, and its poses ignore the levels", () => {
    const levels = fakeLevels(1, 1);
    const orb = start("speaking", true, levels);
    frames.run(1);
    expect(u("uAmp")).toBeCloseTo(0.024 * 0.55, 10);
    expect(u("uEchoAmp")).toBeCloseTo(0.018 * 0.45, 10);
    for (const mood of ["listening", "idle", "connecting", "thinking", "muted", "ended"] as const) {
      orb.setState(mood, true);
      frames.run(1);
      expect(u("uInAmp")).toBe(0);
    }
    expect(levels.reads()).toBe(0);
    // Reading starts when the preference lifts, and stops when it returns.
    orb.setState("listening", false);
    frames.run(1);
    expect(levels.reads()).toBe(60);
    expect(u("uInAmp")).toBe(0.009);
    orb.setState("listening", true);
    frames.run(1);
    expect(levels.reads()).toBe(60);
    expect(u("uInAmp")).toBe(0);
  });

  it("doesn't read while the page is hidden", () => {
    const levels = fakeLevels(1, 1);
    start("speaking", false, levels);
    frames.run(1);
    expect(levels.reads()).toBe(60);
    hidden = true;
    frames.run(1);
    expect(levels.reads()).toBe(60);
  });
});

describe("the Hairline instrument, failing", () => {
  it("throws and leaves no canvas when WebGL2 isn't there", () => {
    stubCanvas(null);
    expect(() => createHairline(host, onFail)).toThrow(/WebGL2 unavailable/);
    expect(host.querySelector("canvas")).toBeNull();
    expect(frames.pending()).toBe(0);
  });

  it("throws and leaves no canvas when the shader doesn't compile", () => {
    glx.compiles = false;
    expect(() => createHairline(host, onFail)).toThrow(/Shader error: it does not compile/);
    expect(host.querySelector("canvas")).toBeNull();
    expect(frames.pending()).toBe(0);
  });

  it("gives up when a lost context isn't back within a second", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    start("listening");
    frames.run(0.5);
    const lost = new Event("webglcontextlost", { cancelable: true });
    host.querySelector("canvas")?.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    const draws = glx.drawn.length;
    frames.run(0.5);
    expect(glx.drawn.length).toBe(draws);
    vi.advanceTimersByTime(RESTORE_MS - 1);
    expect(onFail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(host.querySelector("canvas")).toBeNull();
    expect(frames.pending()).toBe(0);
  });

  it("carries on when the context comes back in time", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    start("listening");
    frames.run(0.5);
    const canvas = host.querySelector("canvas");
    canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(RESTORE_MS / 2);
    const draws = glx.drawn.length;
    canvas?.dispatchEvent(new Event("webglcontextrestored"));
    frames.run(0.5);
    vi.advanceTimersByTime(RESTORE_MS * 3);
    expect(glx.drawn.length).toBeGreaterThan(draws);
    expect(onFail).not.toHaveBeenCalled();
    expect(host.querySelector("canvas")).toBe(canvas);
  });

  it("gives up when the shader won't rebuild on a restored context", () => {
    start("listening");
    const canvas = host.querySelector("canvas");
    canvas?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    glx.compiles = false;
    canvas?.dispatchEvent(new Event("webglcontextrestored"));
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("dispose removes the canvas, stops the loop and leaves no global behind", () => {
    const orb = start("speaking");
    frames.run(0.5);
    orb.dispose();
    expect(host.querySelector("canvas")).toBeNull();
    expect(frames.pending()).toBe(0);
    orb.setState("listening", false);
    expect(frames.pending()).toBe(0);
    expect("hud" in window).toBe(false);
    expect(onFail).not.toHaveBeenCalled();
  });
});
