// Writes src/olympus/cast.json: the part of the Olympus mockup's cast data the
// lane reads, cut from the mockup's page (which its build.py writes from
// assets/figures.json). The mockup lives in another repository, so this is run
// by hand whenever the lane comes to read more of it: add the field to GOD_KEYS
// or POSES below, run it, and commit the JSON.
//
// It also writes src/olympus/mosaic.json: the three floor mosaics the mockup's
// terrain.py cut, from the same page.
//
// Usage (from gg-app):
//   node scripts/olympus-cast.mjs ~/gg-framework-ui/mockups/subagents/v4
//   npx prettier --write src/olympus/cast.json src/olympus/mosaic.json
//
// The pictures are cut from the mockup's too, at twice the size they are
// drawn; with --pictures it writes nothing and lists each skill pose's, each
// second frame's and each stride's name and width:
//   node scripts/olympus-cast.mjs <v4> --pictures | while read name w; do
//     cwebp -quiet -lossless -z 9 -resize $w 200 <v4>/assets/$name.png -o src/olympus/poses/$name.webp
//   done
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Per god, whole: its envelope at a place, that envelope's outline, its open
 * hand, the pose it acts each family of tool in, how far a pose is lifted, and
 * the height its card holds while it works.
 */
const GOD_KEYS = ["name", "env", "envol", "hand", "acts", "lift", "card"];
/**
 * The poses every god has: standing, holding out a line, and in mid stride as
 * it walks. A god's footprint (`fp`) and its top (`top`) are kept for each, and
 * for its skill poses.
 */
const POSES = ["stand", "speak", "stride"];
/** How a god walks, from its move: a dip on each footfall, a lift as it goes, how often it stops to look round, how it sets off and pulls up. */
const MOVE_KEYS = ["bob", "lift", "pause", "ease"];
/** The poses a god is cut into tesserae in: set from the one, and back to the other. */
const TILED = ["speak", "stand"];
/** What a state of a gesture may say: the figure or its part shifted, turned, about-faced, in its second frame, gone, or the one who flies at a height. */
const STATE_KEYS = ["dx", "dy", "rot", "turn", "frame", "lift", "gone"];
/** A gesture, as the lane plays it. */
const MOVE_SHAPE = ["keys", "ease", "w", "part", "pivot", "end"];

/** A CSS polygon's points, in px: [[x, y], ...]. */
function points(polygon, what) {
  const found = /^polygon\((evenodd,)?([^()]+)\)$/.exec(polygon);
  const list = found?.[2].split(",").map((pair) => /^(-?[\d.]+)px (-?[\d.]+)px$/.exec(pair));
  if (!list?.length || list.some((pair) => !pair)) throw new Error(`${what}: not a polygon in px`);
  return list.map((pair) => [Number(pair[1]), Number(pair[2])]);
}

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/olympus-cast.mjs <the mockup's v4 folder>");
  process.exit(1);
}
const html = readFileSync(join(resolve(dir), "olympus.html"), "utf8");
const picturesOnly = process.argv[3] === "--pictures";

function git(...args) {
  return execFileSync("git", ["-C", resolve(dir), ...args], { encoding: "utf8" }).trim();
}
const commit = git("log", "-1", "--format=%h", "--", ".");
const dirty = git("status", "--porcelain", "--", ".") !== "";

/** A small SVG fragment as a tree: [{ tag, attrs, children? }]. */
function svgTree(markup) {
  const root = { children: [] };
  const stack = [root];
  for (const [, close, tag, rawAttrs, selfClose] of markup.matchAll(
    /<(\/)?([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*(\/)?>/g,
  )) {
    if (close) {
      stack.pop();
      continue;
    }
    const attrs = {};
    for (const [, key, value] of rawAttrs.matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[key] = value;
    const node = { tag, attrs };
    const parent = stack[stack.length - 1];
    (parent.children ??= []).push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) throw new Error("unbalanced SVG fragment");
  return root.children;
}

function inner(markup, what) {
  const found = /^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/.exec(markup);
  if (!found) throw new Error(`no ${what}`);
  return { viewBox: found[1], nodes: svgTree(found[2]) };
}

const castData = /<script type="application\/json" id="cast-data">([\s\S]*?)<\/script>/.exec(html);
if (!castData) throw new Error("no cast-data in olympus.html");
const cast = JSON.parse(castData[1]);

const seals = new Set();
const gods = {};
for (const [id, god] of Object.entries(cast.gods)) {
  const template = new RegExp(`<template id="god-${id}">([\\s\\S]*?)</template>`).exec(html)?.[1];
  if (!template) throw new Error(`no template for ${id}`);
  const point = /style="--ex:([\d.]+)px;--ey:([\d.]+)px"/.exec(template);
  const seal = /<svg class="seal"[\s\S]*?<\/svg>/.exec(template)?.[0];
  const fissure = /<svg class="fissure f-stand"[\s\S]*?<\/svg>/.exec(template)?.[0];
  if (!point || !seal || !fissure) throw new Error(`${id}: no seal point, seal or fissure`);
  seals.add(seal);
  const out = {};
  for (const key of GOD_KEYS) {
    if (god[key] === undefined) throw new Error(`${id}: no ${key}`);
    out[key] = god[key];
  }
  out.fp = {};
  out.top = {};
  for (const pose of POSES) {
    if (!god.fp[pose]) throw new Error(`${id}: no footprint for ${pose}`);
    if (typeof god.top[pose] !== "number") throw new Error(`${id}: no top for ${pose}`);
    out.fp[pose] = god.fp[pose];
    out.top[pose] = god.top[pose];
  }
  // Its beat at its place: its move's step, which its cuts fall on, and its
  // stride's as it walks.
  const move = cast.moves[god.move];
  out.step = move?.step;
  if (!(out.step > 0)) throw new Error(`${id}: no step`);
  // How it walks: its move's pace at its trait's, px a second, and the rest of its move.
  const pace = cast.traits[god.trait]?.pace;
  if (!(move.speed > 0) || !(pace > 0)) throw new Error(`${id}: no pace`);
  out.move = { speed: Math.round(move.speed * pace * 100) / 100 };
  for (const key of MOVE_KEYS) {
    if (move[key] === undefined) throw new Error(`${id}: its move has no ${key}`);
    out.move[key] = move[key];
  }
  // Its stride's picture fills the cell, as its stances do.
  const stride = readFileSync(join(resolve(dir), "assets", `${id}-stride.png`));
  if (
    stride.readUInt32BE(16) !== 3 * cast.cell.w ||
    stride.readUInt32BE(20) !== 3 * cast.cell.h ||
    !template.includes(`<img class="pose p-stride" src="assets/${id}-stride.png" alt="">`)
  )
    throw new Error(`${id}: no stride picture the size of the cell`);
  if (picturesOnly) console.log(`${id}-stride ${2 * cast.cell.w}`);
  // Its skill poses: every pose an act names. Each is as wide as it needs, so
  // its picture sits in the cell at a left and a width of its own.
  const skills = new Set(
    Object.values(god.acts).flatMap((act) => [act.pose, ...Object.values(act.verdict ?? {})]),
  );
  if (!god.acts.think) throw new Error(`${id}: no thinking pose`);
  for (const pose of Object.keys(god.lift))
    if (!skills.has(pose)) throw new Error(`${id}: a lift for ${pose}, which no act names`);
  out.at = {};
  for (const pose of skills) {
    const img = new RegExp(
      `<img class="pose p-${pose}" src="assets/${id}-${pose}\\.png" alt="" style="left:(-?[\\d.]+)px;width:([\\d.]+)px`,
    ).exec(template);
    if (!img || !god.fp[pose] || typeof god.top[pose] !== "number")
      throw new Error(`${id}: no picture, footprint or top for ${pose}`);
    const [left, width] = [Number(img[1]), Number(img[2])];
    // The mockup's picture is three times the size it is drawn.
    const png = readFileSync(join(resolve(dir), "assets", `${id}-${pose}.png`));
    if (png.readUInt32BE(16) !== 3 * width || png.readUInt32BE(20) !== 3 * cast.cell.h)
      throw new Error(`${id}-${pose}.png is not ${3 * width}×${3 * cast.cell.h}`);
    out.at[pose] = [left, width];
    out.fp[pose] = god.fp[pose];
    out.top[pose] = god.top[pose];
    if (picturesOnly) console.log(`${id}-${pose} ${2 * width}`);
  }
  // A pose in two frames: its second is shown in place of its first for a
  // move that is a limb's. It sits where its first does, and is as large.
  out.frames = {};
  for (const [pose, frames] of Object.entries(god.frames)) {
    if (!skills.has(pose) || frames.join() !== "b")
      throw new Error(`${id}: ${pose} is no skill pose with one second frame, b`);
    const [left, width] = out.at[pose];
    const png = readFileSync(join(resolve(dir), "assets", `${id}-${pose}-b.png`));
    if (
      png.readUInt32BE(16) !== 3 * width ||
      png.readUInt32BE(20) !== 3 * cast.cell.h ||
      !template.includes(
        `<img class="pose p-${pose} f-b" src="assets/${id}-${pose}-b.png" alt="" style="left:${left}px;width:${width}px">`,
      )
    )
      throw new Error(
        `${id}: no second frame of ${pose} the size of its first, where its first is`,
      );
    out.frames[pose] = frames;
    if (picturesOnly) console.log(`${id}-${pose}-b ${2 * width}`);
  }
  // A pose's cut-out part: the pose's own picture again, clipped to the part
  // (cut), which the lane moves while the pose is shown with the part's hole
  // cut out of it (hole). Both are polygons in the pose's own picture, px.
  out.parts = {};
  for (const [, pose, of, name, src, left, width, clip] of template.matchAll(
    /<img class="part p-([a-z-]+)" data-of="([a-z-]+)" data-part="([a-z]+)" src="assets\/([a-z-]+)\.png" alt="" style="left:(-?[\d.]+)px;width:([\d.]+)px;clip-path:(polygon\([^()]+\))">/g,
  )) {
    const at = out.at[pose];
    const holed = new RegExp(
      `<img class="pose p-${pose}" src="assets/${id}-${pose}\\.png" alt="" style="left:-?[\\d.]+px;width:[\\d.]+px;--hole:(polygon\\([^()]+\\))">`,
    ).exec(template)?.[1];
    if (
      !at ||
      of !== pose ||
      src !== `${id}-${pose}` ||
      Number(left) !== at[0] ||
      Number(width) !== at[1] ||
      out.parts[pose] ||
      out.frames[pose] ||
      !holed
    )
      throw new Error(`${id}: ${pose}'s part is not one cut-out of its own picture, with a hole`);
    const cut = points(clip, `${id} ${pose}'s part`);
    // The hole is all of the picture but a polygon: out to it and back.
    const ring = points(holed, `${id} ${pose}'s hole`);
    const frame = [
      [0, 0],
      [at[1], 0],
      [at[1], cast.cell.h],
      [0, cast.cell.h],
      [0, 0],
    ];
    const hole = ring.slice(frame.length, -1);
    if (
      JSON.stringify(ring.slice(0, frame.length)) !== JSON.stringify(frame) ||
      hole.length < 3 ||
      JSON.stringify(ring[ring.length - 1]) !== JSON.stringify(hole[0])
    )
      throw new Error(`${id}: ${pose}'s hole is not its picture with one polygon out of it`);
    for (const [x, y] of [...cut, ...hole])
      if (x < 0 || x > at[1] || y < 0 || y > cast.cell.h)
        throw new Error(`${id}: ${pose}'s part is outside its picture`);
    out.parts[pose] = { name, cut, hole };
  }
  // Its fidgets, a pose each: what it does while the pose is held, in its own
  // beats from the cut that showed it. A move on the cut is played once; a
  // rhythm's one move comes round every bar; idling, a bar is dealt one of its
  // moves or none. A key is a beat and a state; an eased move's figure eases
  // into each state over `ease` ms, and a limb only ever cuts.
  out.fid = {};
  for (const [pose, fid] of Object.entries(god.fid)) {
    if (!skills.has(pose)) throw new Error(`${id}: a fidget for ${pose}, which no act names`);
    const moves = [...(fid.cut ? [fid.cut] : []), ...fid.moves];
    if (
      Object.keys(fid).join() !== "bar,idle,rest,cut,moves" ||
      !moves.length ||
      (fid.cut ? fid.moves.length > 0 : !(fid.bar > 0)) ||
      (!fid.idle && !fid.cut && fid.moves.length !== 1)
    )
      throw new Error(`${id}: ${pose}'s fidget is not a move on the cut, a rhythm or idling`);
    for (const move of moves) {
      const beats = move.keys.map(([beat]) => beat);
      if (
        Object.keys(move).join() !== MOVE_SHAPE.join() ||
        !beats.length ||
        beats.some((beat, i) => beat < 0 || (beat * 4) % 1 !== 0 || (i && beat <= beats[i - 1])) ||
        !(move.ease >= 0) ||
        !(move.w > 0) ||
        !(move.end >= beats[beats.length - 1]) ||
        (move.part !== null && move.part !== out.parts[pose]?.name)
      )
        throw new Error(`${id}: a move of ${pose} is not keys on the quarter-beat, in order`);
      for (const [, state] of move.keys) {
        if (
          !Object.keys(state).every((key) => STATE_KEYS.includes(key)) ||
          (state.rot !== undefined && !move.pivot) ||
          (state.frame !== undefined && !out.frames[pose]?.includes(state.frame)) ||
          (state.lift !== undefined && !(state.lift > 0 && state.lift <= god.lift[pose])) ||
          (move.part ? state.turn || state.frame || state.lift : state.gone)
        )
          throw new Error(`${id}: a state of ${pose} asks for what the lane cannot play`);
      }
    }
    out.fid[pose] = fid;
  }
  // All a fidget covers is inside the envelope the places and the ribbons are
  // planned with, at every height of the one who flies: the mockup's sweep of
  // each moving pose, band by band, against the outline this file keeps.
  const outline = new Map(god.envol.map(([y, a, b]) => [y, [a, b]]));
  for (const pose of Object.keys(out.fid)) {
    if (!god.sw[pose]) throw new Error(`${id}: no sweep for ${pose}, which fidgets`);
    for (const [y, a, b] of god.sw[pose]) {
      for (let up = 0; up <= (god.lift[pose] ?? 0); up += 2) {
        const band = outline.get(y - up);
        if (!band || a < band[0] || b > band[1])
          throw new Error(`${id}: ${pose}'s fidget leaves the envelope at ${y - up}`);
      }
    }
  }
  // Its tesserae: the two poses it is set from and goes back to, each cut in
  // courses from the feet up (top, bottom, left in tenths of a px, a stone's
  // width in hundredths, then a stone a character: its ivory in the palette,
  // or "-" where the figure isn't).
  const tiles = god.tiles;
  if (!Array.isArray(tiles?.palette) || !tiles.palette.every((hex) => /^#[0-9a-f]{6}$/.test(hex)))
    throw new Error(`${id}: no palette for its tesserae`);
  out.tiles = { palette: tiles.palette };
  for (const pose of TILED) {
    const rows = tiles[pose];
    if (!Array.isArray(rows) || !rows.length) throw new Error(`${id}: no tesserae for ${pose}`);
    for (const row of rows) {
      const stones = [...String(row[4])].filter((ch) => ch !== "-");
      if (
        row.length !== 5 ||
        !row.slice(0, 4).every(Number.isInteger) ||
        !stones.length ||
        !stones.every((ch) => parseInt(ch, 36) < tiles.palette.length)
      )
        throw new Error(`${id}: a course of ${pose} is not top, bottom, left, width, stones`);
    }
    out.tiles[pose] = rows;
  }
  // Where the seal is pressed on the rolled scroll, in the cell.
  out.seal = [Number(point[1]), Number(point[2])];
  // The crack across the standing figure, in the cell.
  out.fissure = inner(fissure, "fissure").nodes;
  gods[id] = out;
}
if (seals.size !== 1) throw new Error("the gods' seals differ: keep one each");

if (picturesOnly) process.exit(0);

const data = {
  source: `gg-framework-ui mockups/subagents/v4/olympus.html at ${commit}${dirty ? " (with uncommitted changes)" : ""}`,
  cell: cast.cell,
  seal: inner([...seals][0], "seal"),
  gods,
};
const target = join(dirname(fileURLToPath(import.meta.url)), "../src/olympus/cast.json");
writeFileSync(target, `${JSON.stringify(data)}\n`);
console.log(`wrote ${target}: ${Object.keys(gods).join(", ")} from ${data.source}`);

// The floor's mosaics: each scene in a few dark stones, cut in courses from
// the stylobate up (top, bottom, left in tenths of a px; each cell's width in
// tenths; a stone a character, its place in the palette; then the cells nipped
// in two on an outline: which, the cut's angle in degrees, how far from the
// cell's middle in tenths, and the stone beyond it).
const SCENES = ["temple", "grove", "agora"];
const terrainData = /<script type="application\/json" id="terrain-data">([\s\S]*?)<\/script>/.exec(
  html,
);
if (!terrainData) throw new Error("no terrain-data in olympus.html");
const terrain = JSON.parse(terrainData[1]);
if (terrain.w !== 698 || terrain.h !== 104)
  throw new Error("the floor is not cut for the lane: 698 by 104");
if (terrain.scenes.map((scene) => scene.id).join() !== SCENES.join())
  throw new Error(`the scenes are not ${SCENES.join(", ")}`);
const scenes = terrain.scenes.map(({ id, name, palette, rows }) => {
  if (!name || !Array.isArray(palette) || !palette.every((hex) => /^#[0-9a-f]{6}$/.test(hex)))
    throw new Error(`${id}: no name or no palette`);
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${id}: no courses`);
  for (const row of rows) {
    const [, , , widths, stones, cuts] = row;
    if (
      row.length !== 6 ||
      !row.slice(0, 3).every(Number.isInteger) ||
      !Array.isArray(widths) ||
      !widths.every((w) => Number.isInteger(w) && w > 0) ||
      typeof stones !== "string" ||
      stones.length !== widths.length ||
      ![...stones].every((ch) => Number(ch) < palette.length) ||
      !Array.isArray(cuts) ||
      !cuts.every(
        (cut) =>
          cut.length === 4 &&
          cut.every(Number.isInteger) &&
          cut[0] >= 0 &&
          cut[0] < widths.length &&
          cut[3] >= 0 &&
          cut[3] < palette.length,
      )
    )
      throw new Error(`${id}: a course is not top, bottom, left, widths, stones, cuts`);
  }
  return { id, name, palette, rows };
});
const floor = { source: data.source, w: terrain.w, h: terrain.h, scenes };
const floorTarget = join(dirname(fileURLToPath(import.meta.url)), "../src/olympus/mosaic.json");
writeFileSync(floorTarget, `${JSON.stringify(floor)}\n`);
console.log(`wrote ${floorTarget}: ${SCENES.join(", ")} from ${floor.source}`);
