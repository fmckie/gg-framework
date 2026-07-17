import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { buildFcpxml } from "../core/fcpxml.js";
import { compact, err } from "../core/format.js";
import { reformatSpec } from "../core/reformat.js";
import { safeOutputPath } from "../core/safe-paths.js";

const EventSchema = z.object({
  reel: z.string(),
  sourcePath: z.string(),
  sourceInFrame: z.number().int().min(0),
  sourceOutFrame: z.number().int().min(1),
  clipName: z.string().optional(),
  sourceDurationFrames: z.number().int().positive().optional(),
});

const ReformatTimelineParams = z.object({
  output: z.string().describe("Output .fcpxml path (relative resolves to cwd)."),
  preset: z
    .enum(["9:16", "1:1", "4:5", "16:9", "4:3"])
    .describe("Target aspect ratio. 9:16 for TikTok/Reels/Shorts."),
  title: z.string(),
  frameRate: z.number().positive(),
  events: z.array(EventSchema).min(1),
});

export function createReformatTimelineTool(cwd: string): AgentTool<typeof ReformatTimelineParams> {
  return {
    name: "reformat_timeline",
    description:
      "Generate an FCPXML preset for a target aspect ratio (9:16 / 1:1 / 4:5 / 16:9 / 4:3). " +
      "Pair with import_edl to land a vertical/square version of an existing edit. The host " +
      "(Resolve Studio Smart Reframe / Premiere Auto Reframe) handles the per-clip reframe " +
      "after import. Output is one-line confirmation only.",
    parameters: ReformatTimelineParams,
    async execute({ output, preset, title, frameRate, events }) {
      try {
        const spec = reformatSpec(preset);
        const text = buildFcpxml({
          title: `${title} [${spec.label}]`,
          frameRate,
          width: spec.width,
          height: spec.height,
          events,
        });
        const abs = safeOutputPath(cwd, output);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text, "utf8");
        return compact({
          ok: true,
          path: abs,
          preset: spec.preset,
          width: spec.width,
          height: spec.height,
          events: events.length,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
