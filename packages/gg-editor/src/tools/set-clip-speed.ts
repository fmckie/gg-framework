import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const SetClipSpeedParams = z.object({
  clipId: z.string().min(1).describe("Clip id from get_timeline."),
  speed: z
    .number()
    .positive()
    .describe("Speed multiplier. 1=100%, 0.5=slow-mo (50%), 2=fast (200%)."),
});

export function createSetClipSpeedTool(host: VideoHost): AgentTool<typeof SetClipSpeedParams> {
  return {
    name: "set_clip_speed",
    description:
      "Retime a clip on the active timeline. 0.5 = half-speed slow-mo, 2 = double-time. " +
      "Useful for highlight reels, vlog energy bumps, and B-roll inserts in podcasts. " +
      "If the host's API rejects, fall back to FCPXML rebuild with explicit timeMap.",
    parameters: SetClipSpeedParams,
    async execute({ clipId, speed }) {
      try {
        await host.setClipSpeed(clipId, speed);
        return "ok";
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
