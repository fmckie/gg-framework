import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const CutAtParams = z.object({
  track: z.number().int().min(1),
  frame: z.number().int().min(0),
});

export function createCutAtTool(host: VideoHost): AgentTool<typeof CutAtParams> {
  return {
    name: "cut_at",
    description:
      "Razor-cut on a track at a frame. Splits one clip into two. " +
      "If host returns unsupported, use write_edl + import_edl for bulk cuts.",
    parameters: CutAtParams,
    async execute({ track, frame }) {
      try {
        await host.cutAt(track, frame);
        return "ok";
      } catch (e) {
        return err((e as Error).message, "use write_edl + import_edl");
      }
    },
  };
}
