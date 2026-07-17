import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const InsertBrollParams = z.object({
  mediaPath: z.string().describe("B-roll source file (relative resolves to cwd)."),
  track: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Video track index. Default 2 (above main A-roll on V1)."),
  recordFrame: z
    .number()
    .int()
    .min(0)
    .describe("Frame on the active timeline where the b-roll begins."),
  sourceInFrame: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("In-point on the source clip (frames). Default 0."),
  sourceOutFrame: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Out-point on the source clip (frames). Default = clip duration."),
});

export function createInsertBrollTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof InsertBrollParams> {
  return {
    name: "insert_broll",
    description:
      "Place a b-roll/cutaway clip on a higher track at a specific timeline frame, " +
      "without disturbing the main video. Default track=2. Pair with read_transcript " +
      "to find moments to cover (filler, ums, awkward pauses) and score_shot or media " +
      "browsing to pick the b-roll. The main audio stays underneath.",
    parameters: InsertBrollParams,
    async execute({ mediaPath, track = 2, recordFrame, sourceInFrame, sourceOutFrame }, _ctx) {
      try {
        const abs = resolvePath(cwd, mediaPath);
        const r = await host.insertClipOnTrack({
          mediaPath: abs,
          track,
          recordFrame,
          sourceInFrame,
          sourceOutFrame,
        });
        return compact(r);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
