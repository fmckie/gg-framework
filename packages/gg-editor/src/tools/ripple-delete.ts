import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const RippleDeleteParams = z.object({
  track: z.number().int().min(1),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(1),
});

export function createRippleDeleteTool(host: VideoHost): AgentTool<typeof RippleDeleteParams> {
  return {
    name: "ripple_delete",
    description:
      "Delete a frame range on a track AND close the gap. " +
      "If unsupported, build a fresh EDL with write_edl + import_edl.",
    parameters: RippleDeleteParams,
    async execute({ track, startFrame, endFrame }) {
      if (endFrame <= startFrame) return err("endFrame must be > startFrame");
      try {
        await host.rippleDelete(track, { start: startFrame, end: endFrame });
        return "ok";
      } catch (e) {
        return err((e as Error).message, "use write_edl + import_edl");
      }
    },
  };
}
