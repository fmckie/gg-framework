// @vitest-environment jsdom
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RESTORE_MS } from "./hairline/engine";
import { fakeFrames, fakeGl, stubCanvas, type FakeGl, type Frames } from "./hairline/testGl";
import type { OrbLevels, OrbMood, VoiceOrbProps } from "./VoiceOrb";

const classic = vi.hoisted(() => ({ props: [] as unknown[] }));

// Today's orb is three.js: not something jsdom can draw.
vi.mock("./VoiceOrbClassic", () => ({
  VoiceOrbClassic: (props: VoiceOrbProps) => {
    classic.props.push(props);
    return <div data-testid="classic-orb" data-mood={props.mood} className={props.className} />;
  },
}));

const { VoiceOrb } = await import("./VoiceOrb");

const MOODS: OrbMood[] = [
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "muted",
  "ended",
];
const levels = (): OrbLevels => ({ out: null, in: null });

let glx: FakeGl;
let frames: Frames;
let warn: ReturnType<typeof vi.spyOn>;

interface Shown {
  readonly container: HTMLElement;
  rerender(props: Partial<VoiceOrbProps>): void;
  unmount(): void;
}

function show(props: Partial<VoiceOrbProps> = {}): Shown {
  const orb = (more: Partial<VoiceOrbProps>): React.ReactElement => (
    <Suspense fallback={<div data-testid="loading" />}>
      <VoiceOrb className="voice-orb" mood="listening" levels={levels} {...props} {...more} />
    </Suspense>
  );
  const view = render(orb({}));
  return {
    container: view.container,
    rerender: (more) => view.rerender(orb(more)),
    unmount: view.unmount,
  };
}

const layer = (name: string): Element | null => document.querySelector(`[data-layer="${name}"]`);
const flat = (): Element | null => document.querySelector("svg.hairline-flat");

beforeEach(() => {
  glx = fakeGl();
  frames = fakeFrames();
  stubCanvas(glx);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  classic.props.length = 0;
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("platform-ios");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VoiceOrb on the desktop", () => {
  it("draws the Hairline instrument on a canvas in the orb's box", () => {
    const { container } = show();
    const box = container.querySelector(".voice-orb");
    expect(box?.getAttribute("aria-hidden")).toBe("true");
    expect(box?.querySelectorAll("canvas")).toHaveLength(1);
    expect(flat()).toBeNull();
    expect(screen.queryByTestId("classic-orb")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    frames.run(0.1);
    expect(glx.drawn.length).toBeGreaterThan(0);
  });

  it("hands the mood and the reduced-motion preference to the instrument", () => {
    const { rerender } = show({ mood: "listening" });
    frames.run(1);
    expect(glx.uniforms.get("uLive")).toBeCloseTo(0.92, 5);
    rerender({ mood: "muted", reducedMotion: true });
    frames.run(1 / 60);
    expect(glx.uniforms.get("uMuted")).toBe(1);
    expect(frames.pending()).toBe(0);
  });

  it("removes its canvas when the screen closes", () => {
    const { container, unmount } = show();
    const box = container.querySelector(".voice-orb");
    unmount();
    expect(box?.querySelector("canvas")).toBeNull();
    expect(frames.pending()).toBe(0);
  });
});

describe("VoiceOrb without WebGL2", () => {
  beforeEach(() => stubCanvas(null));

  it.each(MOODS)("draws %s flat, in the same box, and says nothing to the person", (mood) => {
    const { container } = show({ mood });
    const box = container.querySelector(".voice-orb");
    expect(box?.getAttribute("aria-hidden")).toBe("true");
    expect(box?.querySelector("canvas")).toBeNull();
    expect(flat()?.getAttribute("data-mood")).toBe(mood);
    expect(flat()?.getAttribute("viewBox")).toBe("-190 -190 380 380");
    for (const name of ["plate", "core", "bezel", "arcs", "dots", "ring", "indices"])
      expect(layer(name)).not.toBeNull();
    expect(container.textContent).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(0);
  });

  it("keeps each mood's own look", () => {
    const { rerender } = show({ mood: "listening" });
    // A plain ring until she speaks.
    expect(layer("ring")?.lastElementChild?.tagName).toBe("circle");
    expect(flat()?.getAttribute("stroke")).toBe("#F7F0E8");
    expect(layer("bezel")?.parentElement?.getAttribute("opacity")).toBe("0.92");
    expect(layer("cursor")).toBeNull();
    expect(layer("echo")).toBeNull();
    expect(layer("arcs")?.getAttribute("transform")).toBe("rotate(0)");

    rerender({ mood: "connecting" });
    expect(layer("bezel")?.parentElement?.getAttribute("opacity")).toBe("0.62");
    expect(layer("cursor")?.getAttribute("transform")).toBe("rotate(0)");

    // The rings at their first detent, counterclockwise; the cursor at 45°.
    rerender({ mood: "thinking" });
    expect(layer("arcs")?.getAttribute("transform")).toBe("rotate(-24.06)");
    expect(layer("dots")?.getAttribute("transform")).toBe("rotate(-12.03)");
    expect(layer("bezel")?.getAttribute("transform")).toBe("rotate(-17.76)");
    expect(layer("cursor")?.getAttribute("transform")).toBe("rotate(45)");

    rerender({ mood: "speaking" });
    expect(layer("bezel")?.parentElement?.getAttribute("opacity")).toBe("1");
    expect(layer("ring")?.lastElementChild?.tagName).toBe("path");
    expect(layer("echo")).not.toBeNull();
    expect(layer("cursor")).toBeNull();

    // Grey and dim, in place.
    rerender({ mood: "muted" });
    expect(flat()?.getAttribute("stroke")).toBe("#B3B5BD");
    expect(layer("ring")?.firstElementChild?.getAttribute("stroke")).toBe("#9EA1AB");
    expect(layer("bezel")?.parentElement?.getAttribute("opacity")).toBe("0.34");
    expect(layer("ring")?.lastElementChild?.tagName).toBe("circle");

    // The outer structure retracts to a ghost; the core stays.
    rerender({ mood: "ended" });
    expect(flat()?.getAttribute("stroke")).toBe("#F7F0E8");
    expect(layer("bezel")?.parentElement?.getAttribute("opacity")).toBe("0.48");
    expect(layer("bezel")?.getAttribute("opacity")).toBe("0.18");
    expect(layer("arcs")?.getAttribute("opacity")).toBe("0.1");
    expect(layer("dots")?.getAttribute("opacity")).toBe("0.1");
    expect(layer("ring")?.getAttribute("opacity")).toBe("0.55");
    expect(layer("indices")?.getAttribute("opacity")).toBe("0.3");
    expect(layer("core")?.getAttribute("fill-opacity")).toBe("0.9");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceOrb when WebGL2 breaks", () => {
  it("draws the flat instrument when the shader doesn't compile", () => {
    glx.compiles = false;
    const { container } = show({ mood: "thinking" });
    expect(flat()?.getAttribute("data-mood")).toBe("thinking");
    expect(container.querySelector("canvas")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("draws the flat instrument when a lost context stays lost, and doesn't try WebGL again", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container, rerender } = show({ mood: "speaking" });
    frames.run(0.2);
    const lost = new Event("webglcontextlost", { cancelable: true });
    container.querySelector("canvas")?.dispatchEvent(lost);
    expect(flat()).toBeNull();
    act(() => void vi.advanceTimersByTime(RESTORE_MS));
    expect(flat()?.getAttribute("data-mood")).toBe("speaking");
    expect(container.querySelector("canvas")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    rerender({ mood: "muted" });
    expect(flat()?.getAttribute("data-mood")).toBe("muted");
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceOrb on the iPhone", () => {
  beforeEach(() => document.documentElement.classList.add("platform-ios"));

  it("keeps today's orb, with everything it was given", async () => {
    const { container } = show({ mood: "speaking", reducedMotion: true });
    const orb = await screen.findByTestId("classic-orb");
    expect(orb.getAttribute("data-mood")).toBe("speaking");
    expect(orb.className).toBe("voice-orb");
    expect(classic.props[classic.props.length - 1]).toEqual({
      className: "voice-orb",
      mood: "speaking",
      levels,
      reducedMotion: true,
    });
    expect(container.querySelector("canvas")).toBeNull();
    expect(flat()).toBeNull();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(0);
  });

  it("keeps today's orb even without WebGL2, leaving that to the screen's own fallback", async () => {
    stubCanvas(null);
    show({ mood: "listening" });
    expect(await screen.findByTestId("classic-orb")).not.toBeNull();
    expect(flat()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
