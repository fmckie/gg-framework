import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { buildEdl, totalRecordFrames } from "../core/edl.js";
import { compact, err } from "../core/format.js";
import { safeOutputPath } from "../core/safe-paths.js";

const EventSchema = z.object({
  reel: z
    .string()
    .describe("Source clip identifier (≤8 chars best). NLEs match this to a media pool item."),
  track: z.enum(["V", "A", "B", "A1", "A2"]).default("V"),
  sourceInFrame: z.number().int().min(0),
  sourceOutFrame: z.number().int().min(1),
  clipName: z
    .string()
    .optional()
    .describe("Optional human label for the * FROM CLIP NAME comment."),
});

const WriteEdlParams = z.object({
  output: z.string().describe("Output .edl path (relative paths resolve to cwd)."),
  title: z.string(),
  frameRate: z.number().positive(),
  events: z
    .array(EventSchema)
    .min(1)
    .describe(
      "Ordered list of kept segments. They are laid out contiguously on the record timeline " +
        "in the order given (event N starts where N-1 ends).",
    ),
  dropFrame: z.boolean().optional(),
});

export function createWriteEdlTool(cwd: string): AgentTool<typeof WriteEdlParams> {
  return {
    name: "write_edl",
    description:
      "Write a CMX 3600 EDL file from a decision list. Events are placed contiguously " +
      "on the record timeline in the order given. Use this to BUILD a rebuilt timeline " +
      "(silence cut, take selection, reordering) then call import_edl to load it into " +
      "the host. This is the canonical workaround for Resolve's missing razor.\n\n" +
      "Output is one-line confirmation only (LLM-optimized).",
    parameters: WriteEdlParams,
    async execute({ output, title, frameRate, events, dropFrame }) {
      try {
        const text = buildEdl({ title, frameRate, events, dropFrame });
        const abs = safeOutputPath(cwd, output);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text, "utf8");
        const totalFrames = totalRecordFrames(events);
        return compact({
          ok: true,
          path: abs,
          events: events.length,
          recordFrames: totalFrames,
          recordSec: +(totalFrames / frameRate).toFixed(2),
        });
      } catch (e) {
        return err(
          (e as Error).message,
          "verify event sourceOutFrame > sourceInFrame and frameRate > 0",
        );
      }
    },
  };
}
