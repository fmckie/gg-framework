// Writes src/olympus/cast.json: the part of the Olympus mockup's cast data the
// lane reads, cut from the mockup's page (which its build.py writes from
// assets/figures.json). The mockup lives in another repository, so this is run
// by hand whenever the lane comes to read more of it: add the field to GOD_KEYS
// or POSES below, run it, and commit the JSON.
//
// Usage (from gg-app):
//   node scripts/olympus-cast.mjs ~/gg-framework-ui/mockups/subagents/v4
//   npx prettier --write src/olympus/cast.json
//
// The skill poses' pictures are cut from the mockup's too, at twice the size
// they are drawn; with --pictures it writes nothing and lists each one's name
// and width:
//   node scripts/olympus-cast.mjs <v4> --pictures | while read name w; do
//     cwebp -quiet -lossless -z 9 -resize $w 200 <v4>/assets/$name.png -o src/olympus/poses/$name.webp
//   done
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Per god, whole: its envelope at a place, that envelope's outline, its open
 * hand, the pose it acts each family of tool in, and how far a pose is lifted.
 */
const GOD_KEYS = ["name", "env", "envol", "hand", "acts", "lift"];
/** The poses every god has; a god's footprint (`fp`) is kept for each, and for its skill poses. */
const POSES = ["stand", "speak"];

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
  for (const pose of POSES) {
    if (!god.fp[pose]) throw new Error(`${id}: no footprint for ${pose}`);
    out.fp[pose] = god.fp[pose];
  }
  // Its beat at its place: its move's step, which its cuts fall on.
  out.step = cast.moves[god.move]?.step;
  if (!(out.step > 0)) throw new Error(`${id}: no step`);
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
    if (!img || !god.fp[pose]) throw new Error(`${id}: no picture or footprint for ${pose}`);
    const [left, width] = [Number(img[1]), Number(img[2])];
    // The mockup's picture is three times the size it is drawn.
    const png = readFileSync(join(resolve(dir), "assets", `${id}-${pose}.png`));
    if (png.readUInt32BE(16) !== 3 * width || png.readUInt32BE(20) !== 3 * cast.cell.h)
      throw new Error(`${id}-${pose}.png is not ${3 * width}×${3 * cast.cell.h}`);
    out.at[pose] = [left, width];
    out.fp[pose] = god.fp[pose];
    if (picturesOnly) console.log(`${id}-${pose} ${2 * width}`);
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
