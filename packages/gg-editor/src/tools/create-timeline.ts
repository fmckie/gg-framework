import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const CreateTimelineParams = z.object({
  name: z.string().min(1),
  fps: z.number().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export function createCreateTimelineTool(host: VideoHost): AgentTool<typeof CreateTimelineParams> {
  return {
    name: "create_timeline",
    description:
      "Create a new (empty) timeline / sequence on the host with a given name, fps, and " +
      "optional resolution. Use before rough-cut workflows or when reformatting for " +
      "shorts (9:16 / 1:1 / 4:5).\n\n" +
      "Host caveats:\n" +
      "  - Resolve: fps applies only if the project has no existing timelines (project fps locks once any timeline exists). width/height applied via custom timeline settings.\n" +
      "  - Premiere: requires a .sqpreset file we don't currently ship; falls back to CLONING the active sequence and renaming. fps/width/height are IGNORED in the fallback path \u2014 the new sequence inherits the active one's settings. For a different fps/aspect on Premiere, use reformat_timeline + import_edl instead.",
    parameters: CreateTimelineParams,
    async execute({ name, fps, width, height }) {
      try {
        await host.createTimeline({ name, fps, width, height });
        // Premiere fallback ignores fps/width/height; tell the agent so it
        // doesn't assume those took effect.
        if (host.name === "premiere" && (width || height || fps)) {
          return "ok:cloned-active-sequence; fps/width/height ignored on Premiere fallback";
        }
        return "ok";
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
