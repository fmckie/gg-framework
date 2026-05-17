/* eslint-disable */
/**
 * Shared constants for the Premiere UXP commands.
 *
 * Premiere stores positions in **ticks** at a fixed quantum:
 *   254_016_000_000 ticks = 1 second
 * (verified in adb-mcp + AdobeDocs/uxp-premiere-pro-samples)
 *
 * To convert frames ↔ ticks you also need the sequence's per-frame timebase
 * (sequence.getTimebase() returns the tick count per frame). fps is then
 * TICKS_PER_SECOND / timebase.
 */

const TICKS_PER_SECOND = 254016000000;

/**
 * Track type discriminator returned by `track.getType()`. Mirror of the
 * enum in `premierepro` we care about for filtering tracks.
 */
const TRACK_TYPE = {
  VIDEO: "video",
  AUDIO: "audio",
  CAPTION: "caption",
};

/**
 * Premiere's marker color palette is an 8-entry index. These are the names
 * the gg-editor adapter uses (see `../core/marker-colors.ts` on that side);
 * we map them through Premiere's `Marker.MARKER_COLOR_*` enum if available
 * at runtime, falling back to the documented numeric ordering.
 */
const MARKER_COLOR_INDEX = {
  green: 0,
  red: 1,
  purple: 2,
  orange: 3,
  yellow: 4,
  white: 5,
  blue: 6,
  cyan: 7,
};

module.exports = { TICKS_PER_SECOND, TRACK_TYPE, MARKER_COLOR_INDEX };
