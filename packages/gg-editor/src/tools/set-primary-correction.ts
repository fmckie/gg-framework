import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const Triple = z
  .tuple([z.number(), z.number(), z.number()])
  .describe("[R, G, B] triple of floats.");

const SetPrimaryCorrectionParams = z.object({
  clipId: z.string().min(1).describe("Clip id from get_timeline."),
  slope: Triple.optional().describe("Slope (gain). Default neutral [1,1,1]."),
  offset: Triple.optional().describe("Offset (lift). Default neutral [0,0,0]."),
  power: Triple.optional().describe("Power (gamma). Default neutral [1,1,1]."),
  saturation: z.number().optional().describe("Saturation. 1 = neutral."),
  nodeIndex: z.number().int().positive().optional().describe("1-based node index. Default 1."),
});

export function createSetPrimaryCorrectionTool(
  host: VideoHost,
): AgentTool<typeof SetPrimaryCorrectionParams> {
  return {
    name: "set_primary_correction",
    description:
      "Apply a primary CDL (slope/offset/power/saturation) to a clip's grading node " +
      "(Resolve only). At least one of slope/offset/power/saturation must be supplied. " +
      "Cannot create nodes, touch wheels, curves, qualifiers, or windows — use the " +
      "Color page manually for those. Common recipe: apply_lut as base, then nudge with this.",
    parameters: SetPrimaryCorrectionParams,
    async execute({ clipId, slope, offset, power, saturation, nodeIndex }) {
      if (
        slope === undefined &&
        offset === undefined &&
        power === undefined &&
        saturation === undefined
      ) {
        return err("at least one of slope/offset/power/saturation required");
      }
      try {
        await host.setPrimaryCorrection(clipId, {
          slope,
          offset,
          power,
          saturation,
          nodeIndex,
        });
        return "ok";
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
