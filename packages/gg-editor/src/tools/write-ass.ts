import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { buildAss } from "../core/ass.js";
import { safeOutputPath } from "../core/safe-paths.js";

const StyleSchema = z.object({
  name: z.string().min(1),
  fontName: z.string().optional(),
  fontSize: z.number().int().positive().optional(),
  primaryColor: z.string().optional().describe("Hex RRGGBB or RRGGBBAA (CSS-style alpha)."),
  outlineColor: z.string().optional(),
  shadowColor: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
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
    .describe("Numpad-layout alignment. 2=bottom-center, 5=center, 8=top-center."),
  outline: z.number().min(0).optional(),
  shadow: z.number().min(0).optional(),
  marginV: z.number().int().min(0).optional(),
  marginL: z.number().int().min(0).optional(),
  marginR: z.number().int().min(0).optional(),
});

const CueSchema = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  text: z.string(),
  style: z.string().optional(),
});

const WriteAssParams = z.object({
  output: z.string().describe("Output .ass file path (relative resolves to cwd)."),
  cues: z.array(CueSchema).min(1),
  styles: z
    .array(StyleSchema)
    .optional()
    .describe(
      "Subtitle styles. Must include one named 'Default' (auto-injected when omitted). " +
        "Add per-cue style overrides via cue.style.",
    ),
  playResX: z.number().int().positive().optional(),
  playResY: z.number().int().positive().optional(),
  title: z.string().optional(),
});

const VERTICAL_DEFAULT_STYLE = {
  name: "Default",
  fontName: "Arial",
  fontSize: 72,
  primaryColor: "FFFFFF",
  outlineColor: "000000",
  bold: true,
  alignment: 2 as const, // bottom-center
  outline: 4,
  shadow: 1,
  marginV: 220, // sits about a third up from the bottom on a 1920-tall canvas
};

export function createWriteAssTool(cwd: string): AgentTool<typeof WriteAssParams> {
  return {
    name: "write_ass",
    description:
      "Write an Advanced SubStation Alpha (.ass) subtitle file — supports font, color, " +
      "position, bold/italic, outline, and per-cue style overrides. Use this for " +
      "BURNED-IN vertical captions (TikTok / Reels / Shorts). ffmpeg can hardcode them: " +
      "`ffmpeg -i in.mp4 -vf subtitles=cap.ass -c:a copy out.mp4`. Pair with transcribe " +
      "(wordTimestamps=true) + read_transcript (includeWords=true) for word-by-word " +
      "highlight captions. For sentence-level sidecar SRTs, use write_srt instead.",
    parameters: WriteAssParams,
    async execute({ output, cues, styles, playResX, playResY, title }) {
      try {
        const styleList = styles ?? [VERTICAL_DEFAULT_STYLE];
        if (!styleList.find((s) => s.name === "Default")) {
          // The agent passed styles but forgot Default; inject the vertical preset.
          styleList.push(VERTICAL_DEFAULT_STYLE);
        }
        const ass = buildAss({
          title,
          playResX,
          playResY,
          styles: styleList,
          cues,
        });
        const abs = safeOutputPath(cwd, output);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, ass, "utf8");
        return compact({ ok: true, path: abs, cues: cues.length, styles: styleList.length });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
