import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const SmartReframeParams = z.object({
  clipId: z.string().min(1).describe("Clip id from get_timeline."),
  aspect: z.enum(["9:16", "1:1", "4:5", "16:9", "4:3"]),
  frameInterest: z
    .enum(["all", "keyframes", "reference-frame"])
    .optional()
    .describe("Which frames the AI should consider. Default 'all'."),
  referenceFrame: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Required when frameInterest='reference-frame' — the frame to use as anchor."),
});

export function createSmartReframeTool(host: VideoHost): AgentTool<typeof SmartReframeParams> {
  return {
    name: "smart_reframe",
    description:
      "Trigger Resolve Studio's Smart Reframe AI on a single clip. Resolve Studio only " +
      "(free version + Premiere unsupported). Use after reformat_timeline + import_edl to " +
      "auto-track the subject as the AI re-frames each clip into 9:16/1:1/etc. The agent " +
      "should call this PER CLIP that needs subject tracking.",
    parameters: SmartReframeParams,
    async execute({ clipId, aspect, frameInterest, referenceFrame }) {
      if (!host.smartReframe) {
        return err(
          `${host.name} does not support smart_reframe`,
          "use reformat_timeline + import_edl, then trigger Smart Reframe manually in Resolve Studio",
        );
      }
      try {
        await host.smartReframe(clipId, { aspect, frameInterest, referenceFrame });
        return compact({ ok: true, clipId, aspect });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
