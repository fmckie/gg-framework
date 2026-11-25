// Writes src/olympus/cast.json: the part of the Olympus mockup's cast data the
// lane reads, cut from the mockup's page (which its build.py writes from
// assets/figures.json). The mockup lives in another repository, so this is run
// by hand whenever the lane comes to read more of it: add the field to GOD_KEYS
// or POSES below, run it, and commit the JSON.
//
// Usage (from gg-app):
//   node scripts/olympus-cast.mjs ~/gg-framework-ui/mockups/subagents/v4
//   npx prettier --write src/olympus/cast.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Per god, whole: its envelope at a place, that envelope's outline, and its open hand. */
const GOD_KEYS = ["name", "env", "envol", "hand"];
/** The poses the lane draws so far; a god's footprint (`fp`) is kept for each. */
const POSES = ["stand", "speak"];

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/olympus-cast.mjs <the mockup's v4 folder>");
  process.exit(1);
}
const html = readFileSync(join(resolve(dir), "olympus.html"), "utf8");

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
  // Where the seal is pressed on the rolled scroll, in the cell.
  out.seal = [Number(point[1]), Number(point[2])];
  // The crack across the standing figure, in the cell.
  out.fissure = inner(fissure, "fissure").nodes;
  gods[id] = out;
}
if (seals.size !== 1) throw new Error("the gods' seals differ: keep one each");

const data = {
  source: `gg-framework-ui mockups/subagents/v4/olympus.html at ${commit}${dirty ? " (with uncommitted changes)" : ""}`,
  cell: cast.cell,
  seal: inner([...seals][0], "seal"),
  gods,
};
const target = join(dirname(fileURLToPath(import.meta.url)), "../src/olympus/cast.json");
writeFileSync(target, `${JSON.stringify(data)}\n`);
console.log(`wrote ${target}: ${Object.keys(gods).join(", ")} from ${data.source}`);
