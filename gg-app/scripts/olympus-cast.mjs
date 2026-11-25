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
// second frame's, each stride's, the crown's and each start's name and width:
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
/** How far a pose turned to face may stand outside the mockup's sweep of it, px: that sweep's grain. */
const TURN_SLACK = 0.25;
/** The events a god may notice. */
const NOTICED = ["arrive", "done", "fail"];
/** How far a start's figure may reach along the floor past its god's envelope, px: the mockup's. */
const START_REACH = 2;

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

// The startle: how long a start's hop eases back to the floor, in the god's
// own beats; within how long of its last start, ms, a god starts smaller, and
// for how many beats then; and how far a line is kept off a start, px.
const startle = cast.startle ?? {};
if (
  Object.keys(startle).join() !== "down,again,again_beats,line" ||
  !(startle.down > 0) ||
  (startle.down * 4) % 1 !== 0 ||
  !(startle.again > 0) ||
  !(startle.again_beats > 0) ||
  (startle.again_beats * 4) % 1 !== 0 ||
  !(startle.line >= 0)
)
  throw new Error("the startle is not an ease, a while, its beats and a line's room");

const seals = new Set();
const gods = {};
/** Each god's start, for what is checked once the floor is read, and what is said of it. */
const starts = [];
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
  // How it notices another god, a skill pose each: the floor under its front,
  // which a glance leans about, and under its heel, for a glance back; how far
  // it leans, in degrees; and whether the pose may turn to face.
  out.nt = {};
  for (const [pose, nt] of Object.entries(god.nt)) {
    if (
      !skills.has(pose) ||
      Object.keys(nt).join() !== "front,back,lean,turn" ||
      !(nt.lean > 0) ||
      typeof nt.turn !== "boolean" ||
      [nt.front, nt.back].some(
        (pivot) => pivot.length !== 2 || !Number.isFinite(pivot[0]) || pivot[1] !== cast.cell.h,
      )
    )
      throw new Error(`${id}: ${pose}'s notice is not a lean about the floor, and a turn or none`);
    out.nt[pose] = nt;
  }
  for (const pose of skills)
    if (!out.nt[pose]) throw new Error(`${id}: no notice for ${pose}, which an act names`);
  // How readily it notices each kind of event: its trait's, by the table's.
  out.chance = {};
  for (const [kind, [trait, by]] of Object.entries(cast.notice.chance)) {
    const chance = Math.min(1, cast.traits[god.trait]?.[trait] * by);
    if (!(chance > 0)) throw new Error(`${id}: no chance of noticing: ${kind}`);
    out.chance[kind] = Math.round(chance * 1e4) / 1e4;
  }
  // Its crown, if it gives one: for how many of its beats it is held, how late
  // it may begin, ms, and where its picture sits in the cell, as a skill
  // pose's does. It is shown in place of the pose the record asks for.
  out.rx = {};
  for (const [name, rx] of Object.entries(god.rx)) {
    const img = new RegExp(
      `<img class="pose p-crown" src="assets/${id}-crown\\.png" alt="" style="left:(-?[\\d.]+)px;width:([\\d.]+)px">`,
    ).exec(template);
    const beats = rx.keys?.[1]?.[0];
    if (
      name !== "crown" ||
      !img ||
      rx.on !== "done" ||
      !(rx.late > 0) ||
      !(beats > 0) ||
      (beats * 4) % 1 !== 0 ||
      JSON.stringify(rx.keys) !==
        JSON.stringify([
          [0, { pose: "crown" }],
          [beats, {}],
        ]) ||
      !god.ol.crown
    )
      throw new Error(`${id}: ${name} is not a crown for a finish, shown and then put away`);
    const [left, width] = [Number(img[1]), Number(img[2])];
    const png = readFileSync(join(resolve(dir), "assets", `${id}-crown.png`));
    if (png.readUInt32BE(16) !== 3 * width || png.readUInt32BE(20) !== 3 * cast.cell.h)
      throw new Error(`${id}-crown.png is not ${3 * width}×${3 * cast.cell.h}`);
    out.rx.crown = { late: rx.late, beats, at: [left, width] };
    if (picturesOnly) console.log(`${id}-crown ${2 * width}`);
  }
  // Its start, what it does when the reader clicks it at its work: a hop of
  // its nature's height, px, held for so many of its own beats; where its
  // picture sits in the cell, as a skill pose's does; its top; and its outline
  // there, in bands 2px high: top, from, to. It is shown in place of the pose the
  // record asks for. It is no part of the envelope, which is kept as it was:
  // the lane keeps lines off a start itself, band by band. So here it is held
  // to its picture, to its footprint, to no more than START_REACH past the
  // envelope along the floor, and under the height the card holds.
  {
    const img = new RegExp(
      `<img class="pose p-start" src="assets/${id}-start\\.png" alt="" style="left:(-?[\\d.]+)px;width:([\\d.]+)px">`,
    ).exec(template);
    const st = god.st;
    const bands = god.ol?.start;
    const top = god.top?.start;
    const fp = god.fp?.start;
    if (
      !img ||
      Object.keys(st ?? {}).join() !== "hop,beats" ||
      !(st.hop > 0) ||
      !(st.beats >= startle.again_beats) ||
      (st.beats * 4) % 1 !== 0 ||
      !Array.isArray(bands) ||
      !bands.length ||
      typeof top !== "number" ||
      !fp
    )
      throw new Error(
        `${id}: no start: a picture, a hop, its beats, an outline, a top, a footprint`,
      );
    const [left, width] = [Number(img[1]), Number(img[2])];
    const png = readFileSync(join(resolve(dir), "assets", `${id}-start.png`));
    if (png.readUInt32BE(16) !== 3 * width || png.readUInt32BE(20) !== 3 * cast.cell.h)
      throw new Error(`${id}-start.png is not ${3 * width}×${3 * cast.cell.h}`);
    bands.forEach(([y, a, b], i) => {
      if (
        bands[i].length !== 3 ||
        !Number.isInteger(y) ||
        y % 2 !== 0 ||
        y < 0 ||
        y + 2 > cast.cell.h ||
        (i && y <= bands[i - 1][0]) ||
        !(a < b) ||
        a < left - 0.5 ||
        b > left + width + 0.5
      )
        throw new Error(`${id}: its start's outline is not bands in order, inside its picture`);
    });
    const from = Math.min(...bands.map(([, a]) => a));
    const to = Math.max(...bands.map(([, , b]) => b));
    if (
      Math.abs(from - fp[0]) > 0.05 ||
      Math.abs(to - fp[1]) > 0.05 ||
      top < bands[0][0] ||
      top >= bands[0][0] + 2
    )
      throw new Error(`${id}: its start's outline is not its footprint, from its top`);
    if (fp[0] < god.env[0] - START_REACH || fp[1] > god.env[1] + START_REACH)
      throw new Error(`${id}: its start reaches more than ${START_REACH}px past its envelope`);
    // The highest it reaches: hopped, or, for the one who flies, at her height.
    const up = Math.max(st.hop, ...Object.values(god.lift));
    if (god.card > top - up + 1e-6)
      throw new Error(`${id}: its card at work is not over its start, ${up}px up`);
    // How far it stands outside the envelope's outline, band by band, at any
    // height it is shown at: what the lane's own guard is for. Said, not failed.
    let outside = 0;
    for (const h of new Set([0, st.hop, ...Object.values(god.lift)])) {
      for (const [y, a, b] of bands) {
        for (const [ey, ea, eb] of god.envol) {
          if (ey < y - h + 2 && ey + 2 > y - h) outside = Math.max(outside, ea - a, b - eb);
        }
      }
    }
    starts.push({ id, top, up, outside });
    out.st = { hop: st.hop, beats: st.beats, at: [left, width], top, ol: bands };
    // Its medallion's tilt as it rocks on its peg, degrees.
    if (!(god.medal?.tilt > 0)) throw new Error(`${id}: its medallion has no tilt`);
    out.medal = { tilt: god.medal.tilt };
    if (picturesOnly) console.log(`${id}-start ${2 * width}`);
  }
  // All a fidget and a notice cover is inside the envelope the places and the
  // ribbons are planned with, at every height of the one who flies: the
  // mockup's sweep of each skill pose (its moves, its leans and its turn),
  // band by band, against the outline this file keeps.
  const outline = new Map(god.envol.map(([y, a, b]) => [y, [a, b]]));
  const axis = 2 * cast.cell.head; // facing the other way, a figure is mirrored about its head line
  const inside = (y, a, b, slack) => {
    const band = outline.get(y);
    return band !== undefined && a >= band[0] - slack && b <= band[1] + slack;
  };
  for (const pose of skills) {
    if (!god.sw[pose]) throw new Error(`${id}: no sweep for ${pose}, which fidgets and notices`);
    for (const [y, a, b] of god.sw[pose]) {
      for (let up = 0; up <= (god.lift[pose] ?? 0); up += 2) {
        if (!inside(y - up, a, b, 0))
          throw new Error(`${id}: ${pose}'s fidget or notice leaves the envelope at ${y - up}`);
      }
    }
    // Turned to face, the pose's own outline, mirrored. The mockup sweeps it
    // on a canvas of thirds of a px, so it may stand that far out: TURN_SLACK.
    if (!out.nt[pose].turn) continue;
    for (const [y, a, b] of god.ol[pose]) {
      for (let up = 0; up <= (god.lift[pose] ?? 0); up += 2) {
        if (!inside(y - up, axis - b, axis - a, TURN_SLACK))
          throw new Error(`${id}: ${pose}, turned to face, leaves the envelope at ${y - up}`);
      }
    }
  }
  // The crown is held on the floor, facing either way: its own outline.
  if (out.rx.crown) {
    for (const [y, a, b] of god.ol.crown) {
      if (!inside(y, a, b, 1e-6) || !inside(y, axis - b, axis - a, 1e-6))
        throw new Error(`${id}: its crown leaves the envelope at ${y}`);
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

// How the gods notice each other: how far along the floor a god notices, px;
// how long it rests before it notices again, and how late a notice may begin,
// ms; how long a lean eases in and out, and how long each notice is held, in
// the god's own beats.
const { reach, rest, late, ease, beats } = cast.notice;
if (
  ![reach, rest, late, ease].every((n) => n > 0) ||
  Object.keys(beats).join() !== NOTICED.join() ||
  Object.keys(cast.notice.chance).join() !== NOTICED.join() ||
  !NOTICED.every((kind) => beats[kind] > 2 * ease && (beats[kind] * 4) % 1 === 0) ||
  (ease * 4) % 1 !== 0
)
  throw new Error("the notices are not a reach, a rest, a latest start, an ease and beats each");

// The pool's medallions: how many hang on a side and how far apart, where the
// first hangs from the lane's corner and how wide the pier it hangs on is, px;
// and for how long one is set, shows through, is taken down, and moves up a
// slot, ms. Its box is the stylesheet's: its cameo and its rim.
const pool = cast.pool ?? {};
const POOL_KEYS = ["w", "h", "rim", "peg", "slots", "pitch", "x", "y", "pier", "anta", "edge"];
const POOL_TIMES = ["set", "reveal", "scatter", "slide", "widen"];
// And how one rocks on its peg when pressed: how far back through rest it
// swings, and how much smaller a second rock soon after is, as parts of its tilt.
const POOL_ROCK = ["back", "again"];
if (
  ![...POOL_KEYS, ...POOL_TIMES].every((key) => pool[key] > 0) ||
  !POOL_ROCK.every((key) => pool[key] > 0 && pool[key] <= 1) ||
  !Number.isInteger(pool.slots) ||
  pool.pitch < pool.h + 2 * pool.rim + pool.peg ||
  pool.y + (pool.slots - 1) * pool.pitch + pool.h + 2 * pool.rim > 104 ||
  pool.x + pool.w + 2 * pool.rim > pool.pier
)
  throw new Error(
    "the pool's medallions do not hang clear of each other, on their pier, in the lane",
  );

const data = {
  source: `gg-framework-ui mockups/subagents/v4/olympus.html at ${commit}${dirty ? " (with uncommitted changes)" : ""}`,
  cell: cast.cell,
  seal: inner([...seals][0], "seal"),
  notice: { reach, rest, late, ease, beats },
  startle: {
    down: startle.down,
    again: startle.again,
    againBeats: startle.again_beats,
    line: startle.line,
  },
  pool: Object.fromEntries(
    [...POOL_KEYS, ...POOL_TIMES, ...POOL_ROCK].map((key) => [key, pool[key]]),
  ),
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
// A start, hopped or at her height, stays under the lane's top: the floor over a cell, and no more.
for (const { id, top, up } of starts) {
  if (terrain.h - cast.cell.h + top - up < 0)
    throw new Error(`${id}: its start, ${up}px up, leaves the lane's top`);
}
console.log(
  `starts stand outside their envelope's outline, band by band, by up to ${starts
    .map(({ id, outside }) => `${id} ${Math.round(outside * 10) / 10}`)
    .join(", ")} px: the lane keeps a line ${startle.line}px off a start itself`,
);
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
