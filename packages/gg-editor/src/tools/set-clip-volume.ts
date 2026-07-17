import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const SetClipVolumeParams = z.object({
  clipId: z.string().min(1).describe("Clip id from get_timeline."),
  volumeDb: z
    .number()
    .min(-60)
    .max(24)
    .describe("Gain in dB. 0 = unchanged, -6 = quieter, +3 = louder. Hard limits ±60/24 dB."),
});

export function createSetClipVolumeTool(host: VideoHost): AgentTool<typeof SetClipVolumeParams> {
  return {
    name: "set_clip_volume",
    description:
      "Set a clip's audio gain in dB (Resolve only — Premiere unsupported). " +
      "Standard use: even out level differences across speakers in an interview before " +
      "loudness normalization. ±3 dB is the typical nudge range; ±10+ usually means the " +
      "underlying audio needs cleanup or replacement instead.",
    parameters: SetClipVolumeParams,
    async execute({ clipId, volumeDb }) {
      if (!host.setClipVolume) {
        return err(
          `${host.name} does not support set_clip_volume`,
          "use Resolve for clip-level volume; Premiere requires manual mixer adjustments",
        );
      }
      try {
        await host.setClipVolume(clipId, volumeDb);
        return compact({ ok: true, clipId, volumeDb });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
