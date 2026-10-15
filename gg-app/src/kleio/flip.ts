// FLIP for the voice screen (VoiceMode.tsx): when the panel of what Kleio is
// showing opens or closes, her orb is measured where it was (first) and where
// the new layout puts it (last), then drawn back at first and let go, so it
// glides there. The maths lives here, apart from the DOM, so it can be tested.
//
// Zoom: Kleio zooms the whole page with CSS `zoom` on <html> (ZoomController
// .tsx). getBoundingClientRect measures in zoomed pixels, but a transform is
// written in the page's own pixels, which the zoom then scales again. So a
// distance is divided by the zoom before it becomes a translation, or the orb
// would overshoot by the zoom factor (the double-zoom trap of the orb bug).
// A scale is a ratio of two zoomed sizes, so the zoom cancels out of it.

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** How far is close enough to call it no movement: a hundredth of a pixel, or of a scale. */
const EPSILON = 0.01;

/** `n` rounded to 4 decimal places, never "-0". */
function round(n: number): number {
  const r = Math.round(n * 10_000) / 10_000;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * The transform that draws an element laid out at `last` where it was at
 * `first` (both from getBoundingClientRect, under page zoom `zoom`), for an
 * element whose transform-origin is its top left corner; animating it to
 * `none` then glides it into place. With `scale` false the element keeps its
 * new size and only moves, by its centre (for words and buttons whose width
 * changes with the layout). Null when there is nothing to move, or the boxes
 * can't be measured.
 */
export function flipTransform(first: Box, last: Box, zoom: number, scale = true): string | null {
  const sizes = [first.width, first.height, last.width, last.height];
  if (!sizes.every((n) => Number.isFinite(n) && n > 0)) return null;
  if (!(Number.isFinite(zoom) && zoom > 0)) return null;
  if (![first.left, first.top, last.left, last.top].every(Number.isFinite)) return null;
  const sx = scale ? first.width / last.width : 1;
  const sy = scale ? first.height / last.height : 1;
  const dx = scale
    ? (first.left - last.left) / zoom
    : (first.left + first.width / 2 - (last.left + last.width / 2)) / zoom;
  const dy = scale
    ? (first.top - last.top) / zoom
    : (first.top + first.height / 2 - (last.top + last.height / 2)) / zoom;
  const still =
    Math.abs(dx) < EPSILON &&
    Math.abs(dy) < EPSILON &&
    Math.abs(sx - 1) < EPSILON &&
    Math.abs(sy - 1) < EPSILON;
  if (still) return null;
  const move = `translate(${round(dx)}px, ${round(dy)}px)`;
  return scale ? `${move} scale(${round(sx)}, ${round(sy)})` : move;
}

/** The page's zoom (ZoomController sets `--zoom` on <html>); 1 when unset or odd. */
export function pageZoom(doc: Document = document): number {
  const z = Number.parseFloat(doc.documentElement.style.getPropertyValue("--zoom"));
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** `box` (zoomed pixels, as measured) inside `frame`, in the page's own pixels: what `position: absolute` takes. */
export function boxWithin(box: Box, frame: Box, zoom: number): Box {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    left: round((box.left - frame.left) / z),
    top: round((box.top - frame.top) / z),
    width: round(box.width / z),
    height: round(box.height / z),
  };
}
