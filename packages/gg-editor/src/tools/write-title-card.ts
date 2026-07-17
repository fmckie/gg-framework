import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { buildTitleCardAss } from "../core/text-overlay.js";
import { safeOutputPath } from "../core/safe-paths.js";

const TitleCardSchema = z.object({
  text: z.string().min(1),
  startSec: z.number().min(0),
  durationSec: z.number().positive(),
  fontName: z.string().optional(),
  fontSize: z.number().int().positive().optional(),
  color: z.string().optional().describe("Hex RRGGBB."),
  alignment: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
    ])
    .optional()
    .describe("Numpad alignment. 5 = centre, 8 = top-centre, 2 = bottom-centre."),
  animation: z.enum(["fade-in-out", "zoom-in", "type-on", "none"]).optional(),
});

const WriteTitleCardParams = z.object({
  output: z.string().describe("Output .ass file path."),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  items: z.array(TitleCardSchema).min(1),
});

export function createWriteTitleCardTool(cwd: string): AgentTool<typeof WriteTitleCardParams> {
  return {
    name: "write_title_card",
    description:
      "Write an .ass file containing one or more big-type title cards (chapter cards, " +
      "intro / outro slides, callouts). Animations: fade-in-out, zoom-in, type-on, none. " +
      "Pair with burn_subtitles to render, or import as a subtitle track. Use this for " +
      "section breaks; use write_lower_third for name/role chyrons.",
    parameters: WriteTitleCardParams,
    async execute({ output, width, height, items }) {
      try {
        const ass = buildTitleCardAss(items, { width, height });
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
