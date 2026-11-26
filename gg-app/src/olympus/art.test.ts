import { describe, expect, it } from "vitest";
import { CAMEO_NAMES, placeholder, POSE_NAMES, resolveArt } from "./art";

/** A folder's files as a glob gives them: each picture's URL by its path. */
const files = (folder: string, names: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    names.map((name) => [`../../private-art/olympus/${folder}/${name}.webp`, `/art/${name}.webp`]),
  );

const svgOf = (url: string): string => {
  expect(url).toMatch(/^data:image\/svg\+xml,/);
  return decodeURIComponent(url.slice(url.indexOf(",") + 1));
};

describe("the art's names", () => {
  it("are a cameo a god and the lane's fifty-eight pictures, each once", () => {
    expect(CAMEO_NAMES).toHaveLength(7);
    expect(new Set(CAMEO_NAMES).size).toBe(7);
    expect(POSE_NAMES).toHaveLength(58);
    expect(new Set(POSE_NAMES).size).toBe(58);
    for (const name of POSE_NAMES)
      expect(CAMEO_NAMES.some((god) => name.startsWith(`${god}-`))).toBe(true);
  });
});

describe("resolveArt", () => {
  it("is complete when every picture is there, each under its name", () => {
    const art = resolveArt(files("cameos", CAMEO_NAMES), files("poses", POSE_NAMES));
    expect(art.complete).toBe(true);
    expect(Object.keys(art.cameos)).toEqual([...CAMEO_NAMES]);
    expect(Object.keys(art.poses)).toEqual([...POSE_NAMES]);
    expect(art.cameos.athena).toBe("/art/athena.webp");
    expect(art.poses["themis-think-l"]).toBe("/art/themis-think-l.webp");
  });

  it("has nothing where the folders aren't", () => {
    expect(resolveArt({}, {})).toEqual({ complete: false, cameos: {}, poses: {} });
  });

  it.each([
    ["a cameo", files("cameos", CAMEO_NAMES.slice(1)), files("poses", POSE_NAMES)],
    ["a pose", files("cameos", CAMEO_NAMES), files("poses", POSE_NAMES.slice(0, -1))],
    ["every pose", files("cameos", CAMEO_NAMES), {}],
    [
      "a picture's URL",
      files("cameos", CAMEO_NAMES),
      { ...files("poses", POSE_NAMES), "../../private-art/olympus/poses/nike-crown.webp": "" },
    ],
  ])("uses none of it when %s is missing: never half a lane", (_what, cameos, poses) => {
    expect(resolveArt(cameos, poses)).toEqual({ complete: false, cameos: {}, poses: {} });
  });

  it("leaves out a file that isn't one of the pictures", () => {
    const art = resolveArt(files("cameos", [...CAMEO_NAMES, "zeus"]), {
      ...files("poses", POSE_NAMES),
      "../../private-art/olympus/poses/notes.txt": "/art/notes.txt",
    });
    expect(art.complete).toBe(true);
    expect(Object.keys(art.cameos)).toEqual([...CAMEO_NAMES]);
    expect(Object.keys(art.poses)).toEqual([...POSE_NAMES]);
  });
});

describe("placeholder", () => {
  it("is a drawing the size of its picture, carrying the picture's name", () => {
    const url = placeholder("hermes-run-b", 180, 200, 104);
    const svg = svgOf(url);
    expect(svg).toMatch(/^<svg [^>]*width="180" height="200" viewBox="0 0 180 200">/);
    expect(svg).toContain("<title>hermes-run-b</title>");
    // The name is in the URL as it is written, where the lane's tests look for it.
    expect(url).toContain("hermes-run-b");
  });

  it("stands its figure on the picture's foot, its head on the axis, all inside the picture", () => {
    const svg = svgOf(placeholder("argus-think", 68, 200, 39.6));
    expect(svg).toContain('<circle cx="39.6" cy="31" r="13"');
    const xs = [...svg.matchAll(/[MQLH ](-?[\d.]+) [\d.]+/g)].map((found) => Number(found[1]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(68);
    expect(svg).toMatch(/L[\d.]+ 199H/);
    expect(svg).not.toContain("<ellipse");
  });

  it("draws a cameo's as a bust on an oval ground, inside its 72×96", () => {
    const svg = svgOf(placeholder("athena", 72, 96, 36, "bust"));
    expect(svg).toMatch(/^<svg [^>]*width="72" height="96" viewBox="0 0 72 96">/);
    expect(svg).toContain('<ellipse cx="36" cy="48" rx="35" ry="47"');
    expect(svg).toContain('<circle cx="36" cy="36" r="14"');
  });

  it("is no two pictures' alike, and says nothing of the gods but their names", () => {
    const all = [
      ...CAMEO_NAMES.map((name) => placeholder(name, 72, 96, 36, "bust")),
      ...POSE_NAMES.map((name) => placeholder(name, 146, 200, 66)),
    ];
    expect(new Set(all).size).toBe(65);
    for (const url of all) expect(url.length).toBeLessThan(700);
  });
});
