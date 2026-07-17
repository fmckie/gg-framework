import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { loadBrandKit } from "../core/brand-kit.js";
import { compact, err } from "../core/format.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";
import { safeResolveOutputPath } from "../core/safe-paths.js";
import { composeThumbnailFrame, escapeDrawtextValue, pickFont } from "../core/thumbnail-compose.js";

const ComposeThumbnailParams = z.object({
  input: z.string().describe("Source video."),
  output: z.string().describe("Thumbnail .jpg or .png."),
  atSec: z.number().min(0).describe("Frame timestamp."),
  text: z.string().min(1).describe("Headline text overlay."),
  fontSize: z.number().int().min(8).optional().describe("Default 96."),
  fontColor: z.string().optional().describe("Hex RRGGBB. Default 'white'."),
  outlineColor: z
    .string()
    .optional()
    .describe("Outline hex RRGGBB. Default 'black'. Use empty string to disable."),
  position: z.enum(["top", "center", "bottom"]).optional().describe("Default 'bottom'."),
  fontFile: z
    .string()
    .optional()
    .describe(
      "Path to a TTF font file. ffmpeg drawtext requires this on most systems. " +
        "Default tries common system locations.",
    ),
  width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional output width (height auto). Common: 1280 for YouTube."),
});

export function createComposeThumbnailTool(cwd: string): AgentTool<typeof ComposeThumbnailParams> {
  return {
    name: "compose_thumbnail",
    description:
      "Pull a frame and burn a text headline on top, in one shot. YouTube/TikTok thumbnail " +
      "generation. ffmpeg drawtext requires a TTF font path; we try common system locations " +
      "(macOS Helvetica, DejaVu on Linux, Arial on Windows) when fontFile isn't given. Default " +
      "is large white text with black outline at the bottom — readable at thumbnail scale.",
    parameters: ComposeThumbnailParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, args.input);
        const resolved = safeResolveOutputPath(cwd, args.output);

        // Brand-kit fallback: when fontFile / outlineColor aren't passed, fall
        // back to the kit so a single tool call can pick up channel defaults.
        const brand = loadBrandKit(cwd);
        const brandFont = pickBrandFont(cwd, brand?.fonts?.heading);
        const brandOutline = brand?.colors?.primary;
        const fontFile = args.fontFile ?? brandFont;
        const outlineColor = args.outlineColor ?? brandOutline;
        const brandKitLoaded = brand !== null;

        const r = await composeThumbnailFrame(
          {
            input: inAbs,
            output: resolved.path,
            atSec: args.atSec,
            text: args.text,
            fontFile,
            fontSize: args.fontSize,
            fontColor: args.fontColor,
            outlineColor,
            position: args.position,
            width: args.width,
            signal: ctx.signal,
          },
          cwd,
        );
        return compact({
          ok: true,
          path: r.path,
          atSec: args.atSec,
          fontFile: r.fontFile,
          brandKitLoaded,
          ...(resolved.redirected ? { redirected: true, reason: resolved.reason } : {}),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

// Re-exports for backwards compatibility — older tests import these from here.
export { escapeDrawtextValue, pickFont };

/**
 * Resolve a brand-kit `fonts.heading` value to a readable absolute path.
 * Returns undefined when the kit doesn't define one or the file is missing.
 * Pure-ish (touches the filesystem) — exported for testing.
 */
export function pickBrandFont(cwd: string, heading: string | undefined): string | undefined {
  if (!heading) return undefined;
  const abs = resolvePath(cwd, heading);
  try {
    return existsSync(abs) ? abs : undefined;
  } catch {
    return undefined;
  }
}
