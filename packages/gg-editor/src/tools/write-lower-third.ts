import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { buildLowerThirdAss } from "../core/text-overlay.js";
import { safeOutputPath } from "../core/safe-paths.js";

const LowerThirdSchema = z.object({
  primaryText: z.string().min(1).describe("Big text — name / topic."),
  secondaryText: z.string().optional().describe("Small text — title / role."),
  startSec: z.number().min(0),
  durationSec: z.number().positive(),
  fontName: z.string().optional(),
  primaryColor: z.string().optional().describe("Hex RRGGBB. Default white."),
  accentColor: z.string().optional().describe("Outline / shadow color. Default black."),
  position: z
    .enum(["bottom-left", "bottom-center", "bottom-right", "top-left", "top-center", "top-right"])
    .optional(),
  animation: z.enum(["slide-left", "slide-right", "fade", "none"]).optional(),
  marginPx: z.number().int().min(0).optional(),
});

const WriteLowerThirdParams = z.object({
  output: z.string().describe("Output .ass file path. Pair with burn_subtitles to render."),
  width: z
    .number()
    .int()
    .positive()
    .describe("Canvas width in pixels (1920 horizontal, 1080 vertical)."),
  height: z.number().int().positive(),
  items: z.array(LowerThirdSchema).min(1),
});

export function createWriteLowerThirdTool(cwd: string): AgentTool<typeof WriteLowerThirdParams> {
  return {
    name: "write_lower_third",
    description:
      "Write an .ass file containing one or more animated lower-thirds (name + title chyrons). " +
      "Animations: slide-left/right, fade, none. Pair with burn_subtitles to bake into the " +
      "video, or import as a subtitle track for in-NLE styling. ASS is universally supported " +
      "by ffmpeg's subtitles filter (libass).",
    parameters: WriteLowerThirdParams,
    async execute({ output, width, height, items }) {
      try {
        const ass = buildLowerThirdAss(items, { width, height });
        const outAbs = safeOutputPath(cwd, output);
        mkdirSync(dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, ass, "utf8");
        return compact({ ok: true, path: outAbs, items: items.length });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
