// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { boxWithin, flipTransform, pageZoom, type Box } from "./flip";

/** The orb in the middle of the room, then small in the left column (1280×800 at 100%). */
const CENTRE: Box = { left: 450, top: 120, width: 380, height: 380 };
const LEFT: Box = { left: 106, top: 180, width: 240, height: 240 };

/** The same boxes as getBoundingClientRect reports them at a page zoom. */
const zoomed = (b: Box, z: number): Box => ({
  left: b.left * z,
  top: b.top * z,
  width: b.width * z,
  height: b.height * z,
});

/** Where an element laid out at `last` is drawn with `transform` (origin top left), at zoom `z`. */
function drawnAt(last: Box, transform: string, z: number): Box {
  const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)(?: scale\(([\d.]+), ([\d.]+)\))?$/.exec(
    transform,
  );
  if (!m) throw new Error(`unexpected transform ${transform}`);
  const [, dx = "0", dy = "0", sx = "1", sy = "1"] = m;
  // The zoom scales the transform's pixels too.
  return {
    left: last.left + Number(dx) * z,
    top: last.top + Number(dy) * z,
    width: last.width * Number(sx),
    height: last.height * Number(sy),
  };
}

function expectClose(got: Box, want: Box): void {
  for (const k of ["left", "top", "width", "height"] as const) {
    expect(got[k], k).toBeCloseTo(want[k], 1);
  }
}

describe("flipTransform", () => {
  it("draws the orb back where it was, at 100%", () => {
    const t = flipTransform(CENTRE, LEFT, 1);
    expect(t).toBe("translate(344px, -60px) scale(1.5833, 1.5833)");
    expectClose(drawnAt(LEFT, t ?? "", 1), CENTRE);
    // And back again when the panel closes.
    const back = flipTransform(LEFT, CENTRE, 1);
    expect(back).toBe("translate(-344px, 60px) scale(0.6316, 0.6316)");
    expectClose(drawnAt(CENTRE, back ?? "", 1), LEFT);
  });

  it("divides the distance by the zoom at 120%, so the orb doesn't overshoot", () => {
    const first = zoomed(CENTRE, 1.2);
    const last = zoomed(LEFT, 1.2);
    const t = flipTransform(first, last, 1.2);
    // The same move in the page's own pixels as at 100%: the zoom scales it.
    expect(t).toBe("translate(344px, -60px) scale(1.5833, 1.5833)");
    expectClose(drawnAt(last, t ?? "", 1.2), first);
    // Not dividing would land it 20% too far.
    const naive = drawnAt(last, "translate(412.8px, -72px) scale(1.5833, 1.5833)", 1.2);
    expect(naive.left - first.left).toBeCloseTo(82.56, 1);
  });

  it("moves words and buttons by their centres, keeping their new size", () => {
    const wide: Box = { left: 340, top: 560, width: 600, height: 110 };
    const narrow: Box = { left: 28, top: 600, width: 400, height: 110 };
    expect(flipTransform(wide, narrow, 1, false)).toBe("translate(412px, -40px)");
    expect(flipTransform(zoomed(wide, 1.2), zoomed(narrow, 1.2), 1.2, false)).toBe(
      "translate(412px, -40px)",
    );
  });

  it("does nothing when nothing moved, or the boxes can't be measured", () => {
    expect(flipTransform(CENTRE, CENTRE, 1)).toBeNull();
    expect(flipTransform(CENTRE, { ...CENTRE, left: CENTRE.left + 0.001 }, 1)).toBeNull();
    // A screen not laid out yet (jsdom, a hidden window) measures zeros.
    const none: Box = { left: 0, top: 0, width: 0, height: 0 };
    expect(flipTransform(none, LEFT, 1)).toBeNull();
    expect(flipTransform(CENTRE, none, 1)).toBeNull();
    expect(flipTransform(CENTRE, LEFT, 0)).toBeNull();
    expect(flipTransform(CENTRE, LEFT, Number.NaN)).toBeNull();
    expect(flipTransform({ ...CENTRE, left: Number.POSITIVE_INFINITY }, LEFT, 1)).toBeNull();
  });
});

describe("pageZoom", () => {
  afterEach(() => document.documentElement.style.removeProperty("--zoom"));

  it("reads the zoom ZoomController sets, else 1", () => {
    expect(pageZoom()).toBe(1);
    document.documentElement.style.setProperty("--zoom", "1.2");
    expect(pageZoom()).toBe(1.2);
    document.documentElement.style.setProperty("--zoom", "nope");
    expect(pageZoom()).toBe(1);
    document.documentElement.style.setProperty("--zoom", "-1");
    expect(pageZoom()).toBe(1);
  });
});

describe("boxWithin", () => {
  it("turns a measured box into the page's own pixels inside its frame", () => {
    const frame: Box = { left: 0, top: 0, width: 1536, height: 960 };
    expect(boxWithin({ left: 600, top: 76.8, width: 912, height: 840 }, frame, 1.2)).toEqual({
      left: 500,
      top: 64,
      width: 760,
      height: 700,
    });
    expect(
      boxWithin({ left: 10, top: 20, width: 30, height: 40 }, { ...frame, left: 5 }, 0),
    ).toEqual({ left: 5, top: 20, width: 30, height: 40 });
  });
});
