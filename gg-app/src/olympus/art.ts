// The gods' pictures are private: they are kept out of the repository, in
// gg-app/private-art/olympus on a machine that has them. A checkout without
// them draws a neutral placeholder in each one's place.

/** The cameos the rows and the medallions show: one a god. */
export const CAMEO_NAMES = [
  "argus",
  "athena",
  "hephaestus",
  "hermes",
  "herodotus",
  "nike",
  "themis",
] as const;

/** The pictures the lane draws: each god's stances, its skill poses, their second frames, the crown and its start. */
export const POSE_NAMES = [
  "argus-look",
  "argus-run",
  "argus-speak",
  "argus-stand",
  "argus-start",
  "argus-stride",
  "argus-think",
  "argus-web",
  "athena-look",
  "athena-speak",
  "athena-stand",
  "athena-start",
  "athena-stride",
  "athena-think",
  "hephaestus-look",
  "hephaestus-make",
  "hephaestus-make-b",
  "hephaestus-run",
  "hephaestus-speak",
  "hephaestus-stand",
  "hephaestus-start",
  "hephaestus-stride",
  "hephaestus-think",
  "hermes-look",
  "hermes-make",
  "hermes-run",
  "hermes-run-b",
  "hermes-speak",
  "hermes-stand",
  "hermes-start",
  "hermes-stride",
  "hermes-think",
  "herodotus-look",
  "herodotus-speak",
  "herodotus-stand",
  "herodotus-start",
  "herodotus-stride",
  "herodotus-think",
  "herodotus-web",
  "nike-crown",
  "nike-look",
  "nike-look-b",
  "nike-make",
  "nike-run",
  "nike-speak",
  "nike-stand",
  "nike-start",
  "nike-stride",
  "nike-think",
  "themis-look",
  "themis-run",
  "themis-speak",
  "themis-stand",
  "themis-start",
  "themis-stride",
  "themis-think-l",
  "themis-think-r",
  "themis-web",
] as const;

export type CameoName = (typeof CAMEO_NAMES)[number];

/** The pictures there are, by name. */
export interface Art {
  /** Whether every picture is there. Short of that none is used: a lane is never half drawn. */
  readonly complete: boolean;
  readonly cameos: Readonly<Partial<Record<string, string>>>;
  readonly poses: Readonly<Partial<Record<string, string>>>;
}

/** The expected pictures among a folder's files, which a glob gives by path. */
function pick(names: readonly string[], files: Readonly<Record<string, string>>): string[][] {
  const found = new Map<string, string>();
  for (const [path, url] of Object.entries(files)) {
    const name = /([^/]+)\.webp$/.exec(path)?.[1];
    if (name && url) found.set(name, url);
  }
  return names.flatMap((name) => (found.has(name) ? [[name, found.get(name)!]] : []));
}

/** The art, from the files of its two folders: all of it, or none. */
export function resolveArt(
  cameoFiles: Readonly<Record<string, string>>,
  poseFiles: Readonly<Record<string, string>>,
): Art {
  const cameos = pick(CAMEO_NAMES, cameoFiles);
  const poses = pick(POSE_NAMES, poseFiles);
  if (cameos.length < CAMEO_NAMES.length || poses.length < POSE_NAMES.length)
    return { complete: false, cameos: {}, poses: {} };
  return { complete: true, cameos: Object.fromEntries(cameos), poses: Object.fromEntries(poses) };
}

const STONE = "#aaa69e";
const GROUND = "#34373c";

/**
 * A picture's stand-in, as a data URL: a plain figure the size of the picture,
 * standing on its foot with its head on the axis, or a bust on an oval ground.
 * It carries the picture's name, so no two are alike.
 */
export function placeholder(
  name: string,
  width: number,
  height: number,
  axis: number,
  shape: "figure" | "bust" = "figure",
): string {
  const k = height / (shape === "bust" ? 96 : 200);
  const n = (value: number): number => Math.round(value * 10) / 10;
  const x = (dx: number): number => n(axis + dx * k);
  const y = (dy: number): number => n(dy * k);
  const drawing =
    shape === "bust"
      ? `<ellipse cx="${x(0)}" cy="${y(48)}" rx="${n(35 * k)}" ry="${y(47)}" fill="${GROUND}"/>` +
        `<circle cx="${x(0)}" cy="${y(36)}" r="${n(14 * k)}" fill="${STONE}"/>` +
        `<path d="M${x(-20)} ${y(82)}Q${x(-20)} ${y(57)} ${x(0)} ${y(57)}Q${x(20)} ${y(57)} ${x(20)} ${y(82)}Z" fill="${STONE}"/>`
      : `<circle cx="${x(0)}" cy="${y(31)}" r="${n(13 * k)}" fill="${STONE}"/>` +
        `<path d="M${x(-24)} ${y(64)}Q${x(0)} ${y(42)} ${x(24)} ${y(64)}L${x(19)} ${y(199)}H${x(-19)}Z" fill="${STONE}"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<title>${name}</title>${drawing}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The art on this machine. A folder that isn't there gives no files. */
export const ART: Art = resolveArt(
  import.meta.glob<string>("../../private-art/olympus/cameos/*.webp", {
    eager: true,
    import: "default",
    query: "?url",
  }),
  import.meta.glob<string>("../../private-art/olympus/poses/*.webp", {
    eager: true,
    import: "default",
    query: "?url",
  }),
);

/** A god's cameo: 72×96. */
export function cameoUrl(name: CameoName): string {
  return ART.cameos[name] ?? placeholder(name, 72, 96, 36, "bust");
}

/** One of the lane's pictures, 200 high: its width, and where across it the figure's head is. */
export function poseUrl(name: string, width: number, axis: number): string {
  return ART.poses[name] ?? placeholder(name, width, 200, axis);
}
