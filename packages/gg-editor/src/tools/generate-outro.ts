import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { loadBrandKit } from "../core/brand-kit.js";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeResolveOutputPath } from "../core/safe-paths.js";
import { escapeDrawtextValue } from "./compose-thumbnail.js";

/**
 * generate_outro — render a 3-7s end-screen card from the channel's brand
 * kit (logo + channel name + CTA). Designed for the "every video ends the
 * same way" creator workflow: drop in a `.gg/brand.json` once, then every
 * outro picks up the right typography / logo / CTA automatically.
 *
 * Implementation is intentionally minimal — one ffmpeg call:
 *   - Solid background (brand.colors.primary or black)
 *   - Optional logo overlay (brand.logo) at top-centre
 *   - Channel name (large) + CTA text (smaller) drawn underneath
 *   - Audio: silent stereo (so concat_videos round-trips cleanly)
 *
 * The output is a flat .mp4 ready for `concat_videos` to splice onto the
 * end of the main render. For Resolve-native motion text, the user can
 * still author a Fusion comp; this tool just gives them a one-call default.
 */

const SYSTEM_FONT_GUESSES = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "C:\\Windows\\Fonts\\Arial.ttf",
];

function pickSystemFont(): string | undefined {
  for (const p of SYSTEM_FONT_GUESSES) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

const GenerateOutroParams = z.object({
  output: z.string().describe("Output video path. Default container .mp4."),
  durationSec: z.number().min(1).max(15).optional().describe("Outro length. Default 5s."),
  channelName: z
    .string()
    .optional()
    .describe("Channel name (large headline). Defaults to brand.json channelName."),
  ctaText: z
    .string()
    .optional()
    .describe("CTA line below the channel name. Defaults to brand.json ctaText, then 'Subscribe'."),
  logo: z
    .string()
    .optional()
    .describe(
      "Path to logo PNG. Defaults to brand.json logo. Optional — outro still renders without.",
    ),
  width: z.number().int().positive().optional().describe("Output width. Default 1920."),
  height: z.number().int().positive().optional().describe("Output height. Default 1080."),
  fps: z.number().positive().optional().describe("Default 30."),
  bgColor: z
    .string()
    .optional()
    .describe(
      "Background hex (RRGGBB, no #). Defaults to brand.colors.primary, then '111111' (near-black).",
    ),
  textColor: z.string().optional().describe("Foreground text colour. Default 'white'."),
  fontFile: z
    .string()
    .optional()
    .describe(
      "Path to a TTF/OTF font for ffmpeg drawtext. Defaults to brand.fonts.heading, then a system " +
        "font (Helvetica on macOS, DejaVu on Linux, Arial on Windows).",
    ),
});

export function createGenerateOutroTool(cwd: string): AgentTool<typeof GenerateOutroParams> {
  return {
    name: "generate_outro",
    description:
      "Render a 3–7s outro card from the channel's brand kit (logo + channel name + CTA). Auto-loads " +
      "<cwd>/.gg/brand.json — no args needed in the common case. Output is a flat .mp4 ready for " +
      "concat_videos to splice onto the end of a main render. Pair with `concat_videos([main, outro])`.",
    parameters: GenerateOutroParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const brand = loadBrandKit(cwd);

        const channelName = args.channelName ?? brand?.channelName ?? "";
        const ctaText = args.ctaText ?? brand?.ctaText ?? "Subscribe";
        const logoRel = args.logo ?? brand?.logo;
        const logoAbs = logoRel ? resolvePath(cwd, logoRel) : undefined;
        if (logoAbs && !existsSync(logoAbs)) {
          return err(
            `logo file not found: ${logoAbs}`,
            "fix the brand.json logo path or pass logo='' to skip",
          );
        }

        const width = args.width ?? 1920;
        const height = args.height ?? 1080;
        const fps = args.fps ?? 30;
        const dur = args.durationSec ?? 5;
        const bgColor = args.bgColor ?? brand?.colors?.primary ?? "111111";
        const textColor = args.textColor ?? "white";
        const fontPath =
          (args.fontFile && resolvePath(cwd, args.fontFile)) ||
          (brand?.fonts?.heading && existsSync(resolvePath(cwd, brand.fonts.heading))
            ? resolvePath(cwd, brand.fonts.heading)
            : undefined) ||
          pickSystemFont();
        if (!fontPath) {
          return err(
            "no font available for drawtext",
            "set fontFile or brand.fonts.heading to a TTF path",
          );
        }

        const resolved = safeResolveOutputPath(cwd, args.output);
        const outAbs = resolved.path;
        mkdirSync(dirname(outAbs), { recursive: true });

        // Build filter: solid colour source, optional logo overlay, drawtext lines.
        // The agent's outro is intentionally simple — one headline + one CTA + optional centre logo.
        const escapedName = escapeDrawtextValue(channelName);
        const escapedCta = escapeDrawtextValue(ctaText);
        const headlineSize = Math.round(Math.min(width, height) * 0.08);
        const ctaSize = Math.round(headlineSize * 0.5);
        const drawHeadline = channelName
          ? `drawtext=fontfile=${escapeFilterPath(fontPath)}:text='${escapedName}':fontsize=${headlineSize}:fontcolor=${textColor}:x=(w-text_w)/2:y=(h-text_h)/2-text_h*0.3`
          : "";
        const drawCta = ctaText
          ? `drawtext=fontfile=${escapeFilterPath(fontPath)}:text='${escapedCta}':fontsize=${ctaSize}:fontcolor=${textColor}:x=(w-text_w)/2:y=(h+text_h)/2+text_h*0.6`
          : "";
        const drawChain = [drawHeadline, drawCta].filter(Boolean).join(",");

        const ffArgs: string[] = [
          "-f",
          "lavfi",
          "-t",
          String(dur),
          "-i",
          `color=c=0x${bgColor}:s=${width}x${height}:r=${fps}`,
          "-f",
          "lavfi",
          "-t",
          String(dur),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
        ];
        if (logoAbs) ffArgs.push("-i", logoAbs);

        let filter: string;
        if (logoAbs) {
          // logo: scale to ~20% width, overlay top-centre
          const logoScale = Math.round(width * 0.2);
          filter = `[2:v]scale=${logoScale}:-1[logo];[0:v][logo]overlay=(W-w)/2:H*0.12${drawChain ? `,${drawChain}` : ""}[v]`;
        } else {
          filter = `[0:v]${drawChain || "null"}[v]`;
        }
        ffArgs.push(
          "-filter_complex",
          filter,
          "-map",
          "[v]",
          "-map",
          "1:a",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-crf",
          "20",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          outAbs,
        );

        const r = await runFfmpeg(ffArgs, { signal: ctx.signal });
        if (r.code !== 0)
          return err(`ffmpeg exited ${r.code}`, "check that the font and logo paths are readable");
        return compact({
          ok: true,
          path: outAbs,
          durationSec: dur,
          width,
          height,
          fps,
          channelName: channelName || undefined,
          ctaText,
          logo: logoAbs,
          fontFile: fontPath,
          brandKitLoaded: brand !== null,
          ...(resolved.redirected ? { redirected: true, reason: resolved.reason } : {}),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
