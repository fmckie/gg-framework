// The stele as a picture: drawn straight onto a 2D canvas at twice its size,
// and put on the clipboard as a PNG. If the clipboard refuses, the picture
// opens in the image viewer instead.

import { openImageDataUrl } from "../agent";
import { LAUREL_LEAF, LAUREL_LEAVES, LAUREL_WORDS, type Stele } from "./goal-stele";

/** How a copy went: on the clipboard, in the image viewer instead, or nowhere. */
export type SteleCopy = "copied" | "opened" | "failed";

/** The picture is this many times the stele's own size. */
export const STELE_SCALE = 2;

// The session's palette (kleio-theme.css) and the stylobate's marble (olympus-lane.css).
const INK = "#f6f1f1";
const TEXT = "#d3c9ca";
const MUTED = "#a69c9d";
const SURFACE = "#1d1819";
const EDGE = "#4b4143";
const RULE = "rgb(255 255 255 / 0.07)";
const DONE = "#66b48c";
const MARBLE = ["#e9e2da", "#d2c9bf", "#aca298", "#c3b9af", "#8f857c"] as const;
const CARVED = "#3b3133";
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, sans-serif';
const CARVED_FACE = '"Bungee", Didot, "Bodoni 72", "Bodoni MT", "Times New Roman", serif';
const CAP_FONT = `12px ${CARVED_FACE}`;

const W = 800;
const PAD = 16;
const CAP = 34;
const HEAD = 30;
const ROW = 46;
const TOTALS = 44;
// Where each column starts; the worker's name comes after its cameo.
const COL = { name: PAD + 34, ended: 330, time: 400, tools: 470, tokens: 560 } as const;

/** The picture's size before it is scaled. */
export function steleSize(stele: Stele): { readonly width: number; readonly height: number } {
  return { width: W, height: CAP + HEAD + Math.max(1, stele.lines.length) * ROW + TOTALS };
}

type Brush = CanvasRenderingContext2D;

function tracked(ctx: Brush, spacing: string): void {
  // Not every webview's canvas can track its letters; the words stand either way.
  if ("letterSpacing" in ctx) ctx.letterSpacing = spacing;
}

/** `text`, cut short with an ellipsis where it is wider than `max`. */
function fit(ctx: Brush, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function small(ctx: Brush, text: string, x: number, y: number): void {
  ctx.font = `600 11px ${SANS}`;
  ctx.fillStyle = MUTED;
  tracked(ctx, "0.88px");
  ctx.fillText(text.toUpperCase(), x, y);
  tracked(ctx, "0px");
}

function laurel(ctx: Brush, x: number, y: number): void {
  ctx.fillStyle = DONE;
  for (const leaf of LAUREL_LEAVES) {
    ctx.beginPath();
    ctx.ellipse(
      x + leaf.x,
      y + leaf.y,
      LAUREL_LEAF.rx,
      LAUREL_LEAF.ry,
      (leaf.deg * Math.PI) / 180,
      0,
      2 * Math.PI,
    );
    ctx.fill();
  }
}

/**
 * Draw the stele from its top left corner, at its own size: scale the context
 * first for a larger picture. `images` are the cameos that loaded, by URL; a
 * line whose cameo didn't load goes without.
 */
export function drawStele(
  ctx: Brush,
  stele: Stele,
  images: ReadonlyMap<string, CanvasImageSource>,
): void {
  const { width, height } = steleSize(stele);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, width, height);

  // The cap: the stylobate's marble, the outcome carved in its face.
  const bands = [
    [0, 1],
    [1, 2],
    [3, 1],
    [4, CAP - 5],
    [CAP - 1, 1],
  ] as const;
  bands.forEach(([y, h], i) => {
    ctx.fillStyle = MARBLE[i]!;
    ctx.fillRect(0, y, width, h);
  });
  ctx.font = CAP_FONT;
  ctx.fillStyle = CARVED;
  tracked(ctx, "1.92px");
  ctx.fillText(stele.title.toUpperCase(), PAD, CAP / 2 + 1.5);
  tracked(ctx, "0px");

  // The columns' names.
  let y = CAP;
  const heads = [
    ["Worker", PAD],
    ["Ended", COL.ended],
    ["Time", COL.time],
    ["Tools used", COL.tools],
    ["Tokens", COL.tokens],
  ] as const;
  if (stele.lines.length > 0) for (const [text, x] of heads) small(ctx, text, x, y + HEAD / 2 + 1);
  y += HEAD;

  const rule = (at: number): void => {
    ctx.fillStyle = RULE;
    ctx.fillRect(PAD, at, width - 2 * PAD, 1);
  };
  for (const line of stele.lines) {
    rule(y);
    const mid = y + ROW / 2;
    const failed = line.status === "error";
    const cameo = images.get(line.god.cameo);
    if (cameo) {
      ctx.globalAlpha = failed ? 0.5 : 1;
      ctx.drawImage(cameo, PAD, mid - 16, 24, 32);
      ctx.globalAlpha = 1;
    }
    ctx.font = `500 14px ${SANS}`;
    ctx.fillStyle = INK;
    // The crowned line: its name over what the laurel is for.
    const nameY = line.laurel ? mid - 8 : mid;
    const name = fit(ctx, line.name, COL.ended - COL.name - (line.laurel ? 36 : 14));
    ctx.fillText(name, COL.name, nameY);
    if (line.laurel) {
      laurel(ctx, COL.name + ctx.measureText(name).width + 6, nameY - 8);
      ctx.font = `12px ${SANS}`;
      ctx.fillStyle = DONE;
      ctx.fillText(LAUREL_WORDS, COL.name, mid + 10);
    }
    ctx.font = `13px ${SANS}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(line.ending, COL.ended, mid);
    ctx.fillText(line.time, COL.time, mid);
    ctx.fillText(line.tools, COL.tools, mid);
    ctx.fillText(fit(ctx, line.tokens, width - PAD - COL.tokens), COL.tokens, mid);
    y += ROW;
  }
  if (stele.lines.length === 0) {
    ctx.font = `13px ${SANS}`;
    ctx.fillStyle = MUTED;
    ctx.fillText("No workers were brought in.", PAD, y - HEAD / 2 + ROW / 2);
    y += ROW;
  }

  // The finish card's totals, each figure after its small label.
  rule(y);
  let x = PAD;
  const mid = y + TOTALS / 2;
  for (const total of stele.totals) {
    small(ctx, total.label, x, mid + 1);
    ctx.font = `600 11px ${SANS}`;
    tracked(ctx, "0.88px");
    x += ctx.measureText(total.label.toUpperCase()).width + 8;
    tracked(ctx, "0px");
    ctx.font = `500 14px ${SANS}`;
    ctx.fillStyle = INK;
    ctx.fillText(total.value, x, mid);
    x += ctx.measureText(total.value).width + 28;
  }

  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

/** The cameos the stele shows, loaded: by URL, without any that wouldn't load. */
async function cameosOf(stele: Stele): Promise<Map<string, CanvasImageSource>> {
  const urls = [...new Set(stele.lines.map((line) => line.god.cameo))];
  const loaded = await Promise.all(
    urls.map(
      (url) =>
        new Promise<readonly [string, HTMLImageElement] | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve([url, img]);
          img.onerror = () => resolve(null);
          img.src = url;
        }),
    ),
  );
  return new Map(loaded.filter((entry) => entry !== null));
}

function paint(stele: Stele, images: ReadonlyMap<string, CanvasImageSource>): Promise<Blob> {
  const { width, height } = steleSize(stele);
  const canvas = document.createElement("canvas");
  canvas.width = width * STELE_SCALE;
  canvas.height = height * STELE_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("no 2D canvas"));
  ctx.scale(STELE_SCALE, STELE_SCALE);
  drawStele(ctx, stele, images);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("the canvas gave no picture"))),
      "image/png",
    );
  });
}

/** The stele as a PNG, at twice its size, once its faces and cameos are in. */
export async function steleBlob(stele: Stele): Promise<Blob> {
  const [images] = await Promise.all([
    cameosOf(stele),
    // The carved face, as the lane waits for it; the system's own needs no wait.
    document.fonts?.load(CAP_FONT).catch(() => undefined),
  ]);
  try {
    return await paint(stele, images);
  } catch {
    // A webview that won't read a canvas back once a cameo is on it: the stele without them.
    return paint(stele, new Map());
  }
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("the picture couldn't be read"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Put the stele's picture on the clipboard; if the clipboard refuses, open it
 * in the image viewer. Call it from the click itself: the clipboard is given
 * the picture as a promise, so a webview that only writes within a click
 * (WebKit) still takes it.
 */
export async function copyStele(
  stele: Stele,
  blobOf: (stele: Stele) => Promise<Blob> = steleBlob,
): Promise<SteleCopy> {
  const made = blobOf(stele);
  // The fallback below reads the same promise: a failure there is not unhandled here.
  made.catch(() => undefined);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": made })]);
    return "copied";
  } catch {
    // No clipboard for pictures here, or it refused: the viewer instead.
  }
  try {
    await openImageDataUrl(await dataUrlOf(await made));
    return "opened";
  } catch {
    return "failed";
  }
}
