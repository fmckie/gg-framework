import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { buildFcpxml, totalRecordFramesFcpxml } from "../core/fcpxml.js";
import { compact, err } from "../core/format.js";
import { safeOutputPath } from "../core/safe-paths.js";

const EventSchema = z.object({
  reel: z.string().describe("Source identifier — same reel = same asset in the FCPXML."),
  sourcePath: z.string().describe("Absolute path to the source media file."),
  sourceInFrame: z.number().int().min(0),
  sourceOutFrame: z.number().int().min(1),
  clipName: z.string().optional(),
  sourceDurationFrames: z.number().int().positive().optional(),
});

const WriteFcpxmlParams = z.object({
  output: z.string().describe("Output .fcpxml path (relative resolves to cwd)."),
  title: z.string(),
  frameRate: z.number().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  events: z.array(EventSchema).min(1),
});

export function createWriteFcpxmlTool(cwd: string): AgentTool<typeof WriteFcpxmlParams> {
  return {
    name: "write_fcpxml",
    description:
      "Write an FCPXML 1.10 timeline file from a decision list. Preferred over EDL for " +
      "Premiere imports (preserves clip names, frame-rational time, multi-source assets). " +
      "Both Premiere and Resolve import FCPXML cleanly. Use this for high-fidelity " +
      "interchange — write_edl is the lowest-common-denominator alternative.",
    parameters: WriteFcpxmlParams,
    async execute({ output, title, frameRate, width, height, events }) {
      try {
        const text = buildFcpxml({ title, frameRate, width, height, events });
        const abs = safeOutputPath(cwd, output);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text, "utf8");
        const totalFrames = totalRecordFramesFcpxml(events);
        return compact({
          ok: true,
          path: abs,
          events: events.length,
          assets: new Set(events.map((e) => e.reel)).size,
          recordFrames: totalFrames,
          recordSec: +(totalFrames / frameRate).toFixed(2),
        });
      } catch (e) {
        return err(
          (e as Error).message,
          "verify event sourceOutFrame > sourceInFrame, frameRate > 0, events non-empty",
        );
      }
    },
  };
}
